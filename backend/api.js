import express from "express";
import DBController from "./db-connect.js";
import passport from "passport";
import {Strategy as LocalStrategy} from "passport-local";
import session from "express-session";
import argon2 from "argon2";
import dotenv from "dotenv";
import MongoStore from "connect-mongo";
import path from "path";
dotenv.config();

const app = express();
const production = process.env.NODE_ENV === "production";
const sessionCookie = { httpOnly: true, sameSite: "lax", secure: production, path: "/" };
const rememberDuration = 30 * 24 * 60 * 60 * 1000;

app.use(express.json({ limit: "8mb" }));
app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
});
app.use(session({
    secret: process.env.SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: sessionCookie,
    store: MongoStore.create({
        mongoUrl: process.env.MONGODB_URI,
        ttl: 24 * 60 * 60
    })
}));
app.use(passport.initialize());
app.use(passport.session());
app.use(express.static(path.resolve("../frontend/dist")));

passport.use(new LocalStrategy({usernameField: "kerb"},
    async (kerb, password, done) => {
        try {
            const theUser = await db.findUser(kerb);
            const correct = await argon2.verify(theUser?.password ?? dummyPasswordHash, password);
            if (theUser && correct) {
                return done(null, theUser);
            }
            return done(null, false);
        } catch (e) {
            return done(e);
        }
    }
))
passport.serializeUser((user, done) => {
    done(null, user.kerb);
})
passport.deserializeUser(async (kerb, done) => {
    try {
        const user = await db.findUser(kerb);
        return done(null, user || false);
    } catch (e) {
        return done(e);
    }
})
const db = new DBController();
const { ratingSummary } = DBController;
let dummyPasswordHash;

function validCredentials(kerb, password) {
    return typeof kerb === "string" && kerb.length > 0 && kerb.length <= 64
        && typeof password === "string" && password.length > 0 && password.length <= 256;
}

function summarizeQuestTitle(description) {
    const firstSentence = description.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/)[0]
        .replace(/[.!?]+$/, "")
        .replace(/^(?:please\s+)?(?:can|could) someone\s+/i, "")
        .replace(/^(?:please\s+)?(?:i need help with|need help with|help me with)\s+/i, "");
    const words = firstSentence.split(" ");
    let title = "";
    for (const word of words) {
        const next = title ? `${title} ${word}` : word;
        if (next.length > 54) break;
        title = next;
    }
    if (!title) title = firstSentence.slice(0, 54).trimEnd();
    return `${title.charAt(0).toLocaleUpperCase()}${title.slice(1)}${title.length < firstSentence.length ? "…" : ""}`;
}

(async () => {
    await db.connect();
    dummyPasswordHash = await argon2.hash("unused authentication placeholder");

    console.log("Successfully connected");

    app.get("/api/auth-status", (req, res) => {
        res.json({
            isLoggedIn: req.isAuthenticated(),
            name: req.user?.name ?? "",
            kerb: req.user?.kerb ?? ""
        });
    });


    app.get("/api/posting-limits", async (req, res) => {
        if (!req.isAuthenticated()) return res.status(401).json({ msg: "You need to log in first" });
        const limits = await db.client.withSession(session => session.withTransaction(async () => {
            const user = await db.users.findOne({ kerb: req.user.kerb }, { session });
            return db.postingLimits(user, new Date(), session);
        }, { readConcern: { level: "snapshot" } }));
        res.json(limits);
    });

    app.post("/api/post-request", async (req, res) => {
        if (!req.isAuthenticated()) {
            res.status(401).json({
                result: "fail",
                msg: "You need to log in first"
            })
            return;
        }
        const { description, category, pay, start, end, lat, lng } = req.body ?? {};
        const payoutCents = typeof pay === "number" ? Math.round(pay * 100) : NaN;
        const hasLocation = lat != null || lng != null;
        if (!["Delivery", "Moving", "Home Help", "Tech", "Academic"].includes(category)) {
            return res.status(400).json({ result: "fail", msg: "Choose a quest category." });
        }
        if (typeof description !== "string" || !description.trim() || description.trim().length > 150
            || !Number.isFinite(pay) || !Number.isSafeInteger(payoutCents) || payoutCents <= 0 || payoutCents / 100 !== pay) {
            return res.status(400).json({ result: "fail", msg: "Enter a description and a positive numeric reward amount." });
        }
        if (typeof start !== "string" || typeof end !== "string" || !(Date.parse(end) > Date.parse(start))) {
            return res.status(400).json({ result: "fail", msg: "Choose a deadline after the start time." });
        }
        if (hasLocation && (!Number.isFinite(lat) || Math.abs(lat) > 90
            || !Number.isFinite(lng) || Math.abs(lng) > 180)) {
            return res.status(400).json({ result: "fail", msg: "Choose a valid location on the map." });
        }
        const imageUrl = typeof req.body.imageUrl === "string" ? req.body.imageUrl : "";
        const validPhoto = imageUrl.length <= 7_000_000 && (!imageUrl || /^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/]+=*$/i.test(imageUrl));
        if (!validPhoto) return res.status(400).json({ result: "fail", msg: "Choose an image under 5 MB in PNG, JPEG, WebP, or GIF format." });
        const title = summarizeQuestTitle(description.trim());

        const { error, request } = await db.postRequest({
            requester: req.user.kerb,
            description: description.trim(),
            title,
            category,
            pay,
            payoutCents,
            start,
            end,
            pickup: typeof req.body.pickup === "string" ? req.body.pickup.trim().slice(0, 200) : "",
            dropoff: typeof req.body.dropoff === "string" ? req.body.dropoff.trim().slice(0, 200) : "",
            imageUrl,
            rating: ratingSummary(req.user).rating,
            ...(hasLocation ? { lat, lng } : {}),
        });
        if (error === "insufficient_funds") return res.status(409).json({ msg: "This reward exceeds your available balance." });
        res.status(200).json({ result: "success", msg: "Created request", data: request });
    })

    app.post("/api/toggle-block", async (req, res) => {
        if (!req.isAuthenticated()) {
            res.status(401).json({
                result: "fail",
                msg: "You need to log in first"
            })
            return;
        }
        const body = req.body;
        await db.toggleBlock(req.user.kerb, body.dest);
        res.status(200).json({
            result: "success",
            msg: "Toggled block status"
        })
    })

    app.post("/api/signup", async (req, res) => {
        const { kerb, name, password } = req.body ?? {};
        if (!validCredentials(kerb, password)
            || kerb.trim() !== kerb || !/^[a-zA-Z0-9_-]+$/.test(kerb)
            || typeof name !== "string" || !name.trim() || name.trim().length > 100) {
            return res.status(400).json({ result: "fail", msg: "Enter a name and a valid Kerberos username." });
        }
        if (password.length < 12) {
            return res.status(400).json({ result: "fail", msg: "Use a password with at least 12 characters." });
        }

        try {
            const hash = await argon2.hash(password);
            await db.signup(kerb, name.trim(), hash);
            res.status(200).json({ result: "success", msg: "Account created." });
        } catch (error) {
            if (error.code === 11000) {
                return res.status(409).json({ result: "fail", msg: "An account already exists for that username." });
            }
            throw error;
        }
    });

    app.post("/api/login", (req, res, next) => {
        const { kerb, password, remember } = req.body ?? {};
        const invalidLogin = () => res.status(401).json({
            result: "fail",
            msg: "Incorrect username or password."
        });
        if (!validCredentials(kerb, password)) return invalidLogin();

        passport.authenticate("local", (error, user) => {
            if (error) return next(error);
            if (!user) return invalidLogin();

            req.logIn(user, (loginError) => {
                if (loginError) return next(loginError);
                if (remember === true) req.session.cookie.maxAge = rememberDuration;
                req.session.save((saveError) => {
                    if (saveError) return next(saveError);
                    res.json({ result: "success", msg: "Logged in", kerb: user.kerb, name: user.name ?? "" });
                });
            });
        })(req, res, next);
    });

    app.delete("/api/logout", (req, res, next) => {
        req.logout(error => {
            if (error) return next(error);
            req.session.destroy(destroyError => {
                if (destroyError) return next(destroyError);
                res.clearCookie("connect.sid", sessionCookie);
                res.json({ result: "success", msg: "Logged out" });
            });
        });
    });

    app.get("/api/get-all-requests", async (req, res) => {
        if (!req.isAuthenticated()) {
            res.status(401).json({
                result: "fail",
                msg: "You need to log in first"
            })
            return;
        }
        const requests = await db.getAllRequests();
        const kerbs = [...new Set(requests.map(request => request.requester).filter(Boolean))];
        const owners = await db.users.find({ kerb: { $in: kerbs } }, { projection: { kerb: 1, name: 1 } }).toArray();
        const names = new Map(owners.map(owner => [owner.kerb, owner.name]));
        res.status(200).json({
            result: "success",
            data: requests.map(request => ({ ...request, requesterName: names.get(request.requester) ?? request.requester }))
        })
    })

     app.get("/api/profile", async (req, res) => {
        if (!req.isAuthenticated()) {
            return res.status(401).json({
                msg: "You need to log in first"
            });
        }

        const leaderboard = await db.getLeaderboard(req.user.kerb);
        res.json({
            kerb: req.user.kerb,
            ...ratingSummary(req.user),
            rank: leaderboard.findIndex(user => user.kerb === req.user.kerb) + 1,
            name: req.user.name,
            createdAt: req.user.createdAt ?? null,
            earned: req.user.earned ?? 0,
            quests: req.user.quests ?? 0
        });
    });

    app.get("/api/stripe/connect/status", async (req, res) => {
        if (!req.isAuthenticated()) return res.status(401).json({ msg: "You need to log in first" });
        if (!process.env.STRIPE_SECRET_KEY) return res.json({ configured: false, connected: false });
        try {
            const user = await db.users.findOne({ kerb: req.user.kerb }, { projection: { stripeAccountId: 1 } });
            if (!user?.stripeAccountId) return res.json({ configured: true, connected: false });
            const response = await fetch(`https://api.stripe.com/v1/accounts/${encodeURIComponent(user.stripeAccountId)}`, {
                headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` }
            });
            if (!response.ok) return res.status(502).json({ msg: "Could not check Stripe account status." });
            const account = await response.json();
            res.json({ configured: true, connected: Boolean(account.payouts_enabled), detailsSubmitted: Boolean(account.details_submitted) });
        } catch {
            res.status(502).json({ msg: "Could not check Stripe account status." });
        }
    });

    app.post("/api/stripe/connect/onboarding-link", async (req, res) => {
        if (!req.isAuthenticated()) return res.status(401).json({ msg: "You need to log in first" });
        const stripeKey = process.env.STRIPE_SECRET_KEY;
        const baseUrl = process.env.APP_BASE_URL;
        if (!stripeKey || !baseUrl) {
            return res.status(503).json({ msg: "Stripe setup is unavailable. Configure STRIPE_SECRET_KEY and APP_BASE_URL on the server." });
        }
        let origin;
        try {
            const parsed = new URL(baseUrl);
            if (production && parsed.protocol !== "https:") throw new Error("HTTPS is required");
            origin = parsed.origin;
        } catch {
            return res.status(503).json({ msg: "Stripe setup needs a valid APP_BASE_URL on the server." });
        }
        try {
            const user = await db.users.findOne({ kerb: req.user.kerb }, { projection: { stripeAccountId: 1 } });
            let accountId = user?.stripeAccountId;
            if (!accountId) {
                const accountParams = new URLSearchParams({
                    type: "express",
                    country: "US",
                    "capabilities[transfers][requested]": "true"
                });
                const accountResponse = await fetch("https://api.stripe.com/v1/accounts", {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${stripeKey}`,
                        "Content-Type": "application/x-www-form-urlencoded",
                        "Idempotency-Key": `sidequest-connect-${Buffer.from(req.user.kerb).toString("hex")}`
                    },
                    body: accountParams
                });
                const account = await accountResponse.json();
                if (!accountResponse.ok || !account.id) return res.status(502).json({ msg: "Stripe could not create a connected account." });
                accountId = account.id;
                await db.users.updateOne({ kerb: req.user.kerb }, { $set: { stripeAccountId: accountId } });
            }
            const linkParams = new URLSearchParams({
                account: accountId,
                refresh_url: `${origin}/?stripe=refresh`,
                return_url: `${origin}/?stripe=return`,
                type: "account_onboarding"
            });
            const linkResponse = await fetch("https://api.stripe.com/v1/account_links", {
                method: "POST",
                headers: { Authorization: `Bearer ${stripeKey}`, "Content-Type": "application/x-www-form-urlencoded" },
                body: linkParams
            });
            const link = await linkResponse.json();
            if (!linkResponse.ok || !link.url) return res.status(502).json({ msg: "Stripe could not start account setup." });
            res.json({ url: link.url });
        } catch {
            res.status(502).json({ msg: "Could not connect to Stripe. Please try again." });
        }
    });

    app.get("/api/users/search", async (req, res, next) => {
        if (!req.isAuthenticated()) return res.status(401).json({ msg: "You need to log in first" });
        const query = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 80) : "";
        if (query.length < 2) return res.status(400).json({ msg: "Enter at least two characters." });
        try {
            res.json({ data: await db.searchUsers(query, req.user.kerb) });
        } catch (error) { next(error); }
    });

    app.get("/api/notifications", async (req, res, next) => {
        if (!req.isAuthenticated()) return res.status(401).json({ msg: "You need to log in first" });
        try { res.json({ data: await db.getNotifications(req.user.kerb) }); }
        catch (error) { next(error); }
    });

    app.patch("/api/notifications/:id/read", async (req, res, next) => {
        if (!req.isAuthenticated()) return res.status(401).json({ msg: "You need to log in first" });
        if (!/^[0-9a-fA-F]{24}$/.test(req.params.id)) return res.status(400).json({ msg: "Invalid notification ID" });
        try { await db.markNotificationRead(req.params.id, req.user.kerb); res.json({ result: "success" }); }
        catch (error) { next(error); }
    });

    app.post("/api/feedback", async (req, res, next) => {
        if (!req.isAuthenticated()) return res.status(401).json({ msg: "You need to log in first" });
        const kind = req.body?.kind;
        const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
        if (!["idea", "bug", "other"].includes(kind) || !message || message.length > 2000) {
            return res.status(400).json({ msg: "Choose a feedback type and enter a message under 2,000 characters." });
        }
        try {
            await db.submitFeedback(req.user.kerb, kind, message);
            res.status(201).json({ result: "success" });
        } catch (error) { next(error); }
    });

    app.get("/api/leaderboard", async (req, res, next) => {
        if (!req.isAuthenticated()) return res.status(401).json({ msg: "You need to log in first" });
        try { res.json({ data: (await db.getLeaderboard(req.user.kerb)).slice(0, 7) }); }
        catch (error) { next(error); }
    });

    app.get("/api/requests/:id/messages", async (req, res, next) => {
        if (!req.isAuthenticated()) return res.status(401).json({ msg: "You need to log in first" });
        if (!/^[0-9a-fA-F]{24}$/.test(req.params.id)) return res.status(400).json({ msg: "Invalid request ID" });
        try {
            const request = await db.getRequestById(req.params.id);
            if (!request || ![request.requester, request.helper].includes(req.user.kerb)) return res.status(403).json({ msg: "Chat is available to the requester and assigned helper." });
            const messages = await db.getQuestMessages(req.params.id, typeof req.query.since === "string" ? req.query.since : null);
            res.json({ data: messages.map(message => ({ sender: message.sender, text: message.text, createdAt: message.createdAt, own: message.sender === req.user.kerb })) });
        } catch (error) { next(error); }
    });

    app.post("/api/requests/:id/messages", async (req, res, next) => {
        if (!req.isAuthenticated()) return res.status(401).json({ msg: "You need to log in first" });
        if (!/^[0-9a-fA-F]{24}$/.test(req.params.id)) return res.status(400).json({ msg: "Invalid request ID" });
        const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
        if (!text || text.length > 2000) return res.status(400).json({ msg: "Enter a message under 2,000 characters." });
        try {
            const request = await db.getRequestById(req.params.id);
            if (!request || ![request.requester, request.helper].includes(req.user.kerb)) return res.status(403).json({ msg: "Chat is available to the requester and assigned helper." });
            const message = await db.addQuestMessage(req.params.id, req.user.kerb, text);
            const recipient = request.requester === req.user.kerb ? request.helper : request.requester;
            if (recipient) await db.addNotification(recipient, {
                type: "message", title: `Message from ${req.user.name || req.user.kerb}`, message: text.slice(0, 180), requestId: req.params.id,
            });
            res.status(201).json({ data: { sender: message.sender, text: message.text, createdAt: message.createdAt, own: true } });
        } catch (error) { next(error); }
    });

    app.get("/api/my-requests", async (req, res, next) => {
        if (!req.isAuthenticated()) {
            return res.status(401).json({
                msg: "You need to log in first"
            });
        }

        try {
            const requests = await db.getPostedRequests(req.user.kerb);
            res.json(requests);
        } catch (error) {
            next(error);
        }
    });

    app.delete("/api/requests/:id", async (req, res, next) => {
        if (!req.isAuthenticated()) {
            return res.status(401).json({
                msg: "You need to log in first"
            });
        }

        const { id } = req.params;

        if (!/^[0-9a-fA-F]{24}$/.test(id)) {
            return res.status(400).json({ msg: "Invalid request ID" });
        }

        try {
            const oldRequest = await db.getRequestById(id);
            const result = await db.deleteRequest(id, req.user.kerb);

            if (result.modifiedCount === 0) {
                return res.status(404).json({
                    msg: "Request not found or not owned by you"
                });
            }

            if (oldRequest?.helper) await db.addNotification(oldRequest.helper, {
                type: "quest_removed", title: "Quest removed", message: "The quest you accepted was removed by its poster.", requestId: id,
            });

            res.json({ msg: "Request deleted" });
        } catch (error) {
            next(error);
        }
    });

    app.post("/api/connect-request", async (req, res) => {
        if (!req.isAuthenticated()) {
            res.status(401).json({
                result: "fail",
                msg: "You need to log in first"
            })
            return;
        }
        try {
            const _id = req.body._id;
            if (typeof _id !== "string" || !/^[0-9a-fA-F]{24}$/.test(_id)) return res.status(400).json({ result: "fail", msg: "Invalid request ID" });
            const request = await db.getRequestById(_id);
            const connected = await db.connectRequest(_id, req.user.kerb);
            if (!connected) return res.status(409).json({ result: "fail", msg: "This request is no longer available." });
            if (request?.requester) await db.addNotification(request.requester, {
                type: "accepted", title: "Quest accepted", message: `${req.user.name || req.user.kerb} accepted “${request.description}”.`, requestId: _id,
            });
            res.status(200).json({
                result: "success", msg: "Quest accepted"
            })
        } catch (e) {
            res.status(400).json({
                result: "fail",
                msg: "Bad request"
            })
        }
    })
    app.post("/api/requests/:id/progress", async (req, res, next) => {
        if (!req.isAuthenticated()) return res.status(401).json({ msg: "You need to log in first" });
        if (!/^[0-9a-fA-F]{24}$/.test(req.params.id)) return res.status(400).json({ msg: "Invalid request ID" });
        const stage = req.body.stage;
        if (stage !== "started" && stage !== "picked_up") return res.status(400).json({ msg: "Invalid quest stage" });
        try {
            const request = await db.updateQuestStage(req.params.id, req.user.kerb, stage);
            if (!request) return res.status(409).json({ msg: "Could not update this quest stage." });
            if (request.requester) await db.addNotification(request.requester, {
                type: stage, title: stage === "started" ? "Quest in progress" : "Pickup complete",
                message: stage === "started" ? `${req.user.name || req.user.kerb} started “${request.description}”.` : `Pickup is complete for “${request.description}”. It is ready for delivery.`, requestId: req.params.id,
            });
            res.json({ result: "success" });
        } catch (error) { next(error); }
    });

    app.post("/api/requests/:id/cancel", async (req, res, next) => {
        if (!req.isAuthenticated()) return res.status(401).json({ msg: "You need to log in first" });
        if (!/^[0-9a-fA-F]{24}$/.test(req.params.id)) return res.status(400).json({ msg: "Invalid request ID" });
        try {
            const request = await db.cancelQuest(req.params.id, req.user.kerb);
            if (!request) return res.status(409).json({ msg: "This quest can no longer be cancelled." });
            const isRequester = request.requester === req.user.kerb;
            const recipient = isRequester ? request.helper : request.requester;
            if (recipient) await db.addNotification(recipient, {
                type: "cancelled", title: "Quest cancelled", message: isRequester
                    ? `${req.user.name || req.user.kerb} cancelled “${request.description}”.`
                    : `${req.user.name || req.user.kerb} cancelled their assignment for “${request.description}”; the quest is available again.`, requestId: req.params.id,
            });
            res.json({ result: "success" });
        } catch (error) { next(error); }
    });

    app.post("/api/resolve-request", async (req, res) => {
        if (!req.isAuthenticated()) {
            res.status(401).json({
                result: "fail",
                msg: "You need to log in first"
            })
            return;
        }
        try {
            const _id = req.body._id;
            if (typeof _id !== "string" || !/^[0-9a-fA-F]{24}$/.test(_id)) return res.status(400).json({ result: "fail", msg: "Invalid request ID" });
            const request = await db.resolveRequest(_id, req.user.kerb);
            if (!request) return res.status(409).json({ result: "fail", msg: "Could not complete this quest." });
            if (request.requester) await db.addNotification(request.requester, {
                type: "completed", title: "Quest delivered", message: `“${request.description}” was marked complete.`, requestId: _id,
            });
            res.status(200).json({
                result: "success",
                msg: "resolved request"
            })
        } catch (e) {
            res.status(400).json({
                result: "fail",
                msg: "Bad request"
            })
        }
    })
    app.post("/api/rate-user", async (req, res) => {
        if (!req.isAuthenticated()) return res.status(401).json({ msg: "You need to log in first" });
        const { kerb, rating } = req.body ?? {};
        if (typeof kerb !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(kerb)
            || !/^[a-zA-Z0-9_-]{1,64}$/.test(req.user.kerb) || kerb === req.user.kerb
            || !Number.isInteger(rating) || rating < 1 || rating > 5) {
            return res.status(400).json({ msg: "Choose a rating from 1 to 5 for another user." });
        }
        const summary = await db.rateUser(kerb, req.user.kerb, rating);
        if (!summary) return res.status(403).json({ msg: "You can rate users after completing a quest together." });
        res.json({ ...summary, yourRating: rating });
    });

    app.get("/", async (req, res) => {
        res.status(200).sendFile(path.resolve("../frontend/index.html"));
    })

    app.use((error, req, res, next) => {
        if (res.headersSent) return next(error);
        if (error.type === "entity.parse.failed") {
            return res.status(400).json({ result: "fail", msg: "Invalid JSON request." });
        }
        console.error("API request failed:", req.method, req.path, error.name);
        res.status(500).json({ result: "fail", msg: "The server could not complete the request." });
    });

    app.listen(3000);
})();
