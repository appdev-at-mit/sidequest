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
const writeRateLimits = new Map();
function rateLimited(req, res, bucket, maxHits, windowMs = 60000) {
    const now = Date.now();
    const key = `${bucket}:${req.ip || req.socket.remoteAddress || "unknown"}`;
    const current = writeRateLimits.get(key) ?? { count: 0, expires: now + windowMs };
    if (current.expires <= now) { current.count = 0; current.expires = now + windowMs; }
    current.count += 1;
    writeRateLimits.set(key, current);
    if (writeRateLimits.size > 5000) for (const [entry, value] of writeRateLimits) if (value.expires <= now) writeRateLimits.delete(entry);
    if (current.count <= maxHits) return false;
    res.status(429).json({ msg: "Too many requests. Please wait and try again." });
    return true;
}

app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
        const allowedOrigins = new Set();
        for (const value of [process.env.APP_BASE_URL, process.env.FRONTEND_ORIGIN]) {
            try { if (value) allowedOrigins.add(new URL(value).origin); } catch { /* Invalid configuration is ignored. */ }
        }
        if (!production) for (const value of ["http://localhost:5174", "http://127.0.0.1:5174", "http://localhost:3000", "http://127.0.0.1:3000"]) allowedOrigins.add(value);
        const sameOrigin = `${req.protocol}://${req.get("host")}`;
        const originHeader = req.get("origin");
        let sourceOrigin = originHeader;
        if (!sourceOrigin && req.get("referer")) {
            try { sourceOrigin = new URL(req.get("referer")).origin; } catch { sourceOrigin = ""; }
        }
        if (!sourceOrigin || (!allowedOrigins.has(sourceOrigin) && sourceOrigin !== sameOrigin)
            || req.get("sec-fetch-site") === "cross-site") {
            return res.status(403).json({ msg: "Request origin could not be verified." });
        }
    }
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
const { sanitizeText } = DBController;
let dummyPasswordHash;

function adminKerbs() {
    return new Set((process.env.ADMIN_KERBS ?? "").split(",").map(value => value.trim()).filter(Boolean));
}

function requireAdmin(req, res) {
    if (!req.isAuthenticated()) {
        res.status(401).json({ msg: "You need to log in first." });
        return false;
    }
    if (!adminKerbs().has(req.user.kerb)) {
        res.status(403).json({ msg: "Administrator access is required." });
        return false;
    }
    return true;
}

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


    app.post("/api/post-request", async (req, res) => {
        if (rateLimited(req, res, "post-request", 8, 60 * 60 * 1000)) return;
        if (!req.isAuthenticated()) {
            res.status(401).json({
                result: "fail",
                msg: "You need to log in first"
            })
            return;
        }
        if (await db.userIsSuspended(req.user.kerb)) return res.status(403).json({ result: "fail", msg: "Your account is suspended and cannot post quests." });
        const { description, category, pay, start, end, lat, lng } = req.body ?? {};
        const rewardCents = typeof pay === "number" ? Math.round(pay * 100) : NaN;
        const hasLocation = lat != null || lng != null;
        if (!["Delivery", "Moving", "Home Help", "Tech", "Academic"].includes(category)) {
            return res.status(400).json({ result: "fail", msg: "Choose a quest category." });
        }
        if (typeof description !== "string" || !description.trim() || description.trim().length > 150
            || !Number.isFinite(pay) || !Number.isSafeInteger(rewardCents) || rewardCents <= 0 || rewardCents / 100 !== pay) {
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
        const cleanDescription = sanitizeText(description, 150);
        const title = summarizeQuestTitle(cleanDescription);

        const request = await db.postRequest({
            requester: req.user.kerb,
            description: cleanDescription,
            title,
            category,
            rewardCents,
            start,
            end,
            pickup: sanitizeText(req.body.pickup, 200),
            dropoff: sanitizeText(req.body.dropoff, 200),
            imageUrl,
            ...(hasLocation ? { lat, lng } : {}),
        });
        if (!request) return res.status(403).json({ result: "fail", msg: "Your account is suspended and cannot post quests." });
        res.status(201).json({ result: "success", msg: "Created quest", data: request });
    })

    app.put("/api/requests/:id", async (req, res, next) => {
        if (rateLimited(req, res, "edit-request", 30)) return;
        if (!req.isAuthenticated()) return res.status(401).json({ msg: "You need to log in first" });
        if (!/^[0-9a-fA-F]{24}$/.test(req.params.id)) return res.status(400).json({ msg: "Invalid request ID" });
        const { description, category, pay, start, end } = req.body ?? {};
        const rewardCents = typeof pay === "number" ? Math.round(pay * 100) : NaN;
        if (!["Delivery", "Moving", "Home Help", "Tech", "Academic"].includes(category)) return res.status(400).json({ msg: "Choose a quest category." });
        if (typeof description !== "string" || !description.trim() || description.trim().length > 150
            || !Number.isFinite(pay) || !Number.isSafeInteger(rewardCents) || rewardCents <= 0 || rewardCents / 100 !== pay) {
            return res.status(400).json({ msg: "Enter a description and a positive numeric reward amount." });
        }
        if (typeof start !== "string" || typeof end !== "string" || !(Date.parse(end) > Date.parse(start))) return res.status(400).json({ msg: "Choose a deadline after the start time." });
        try {
            const cleanDescription = sanitizeText(description, 150);
            const request = await db.updateOpenRequest(req.params.id, req.user.kerb, {
                description: cleanDescription, title: summarizeQuestTitle(cleanDescription), category,
                rewardCents, pay, start, end,
            });
            if (!request) return res.status(409).json({ msg: "Only your open, unexpired quests can be edited." });
            res.json({ result: "success", data: request });
        } catch (error) { next(error); }
    });

    app.post("/api/toggle-block", async (req, res) => {
        if (rateLimited(req, res, "toggle-block", 30)) return;
        if (!req.isAuthenticated()) {
            res.status(401).json({
                result: "fail",
                msg: "You need to log in first"
            })
            return;
        }
        const dest = req.body?.dest;
        if (typeof dest !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(dest) || dest === req.user.kerb) return res.status(400).json({ msg: "Choose another valid user." });
        const blocked = await db.toggleBlock(req.user.kerb, dest);
        if (blocked == null) return res.status(404).json({ msg: "User not found." });
        res.status(200).json({
            result: "success",
            blocked,
            msg: blocked ? "User blocked." : "User unblocked."
        })
    })

    app.post("/api/signup", async (req, res) => {
        if (rateLimited(req, res, "signup", 5, 60 * 60 * 1000)) return;
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
        if (rateLimited(req, res, "login", 10, 15 * 60 * 1000)) return;
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
        const requests = await db.getAllRequests(req.user.kerb);
        const kerbs = [...new Set(requests.map(request => request.requester).filter(Boolean))];
        const owners = await db.users.find({ kerb: { $in: kerbs } }, { projection: { kerb: 1, name: 1 } }).toArray();
        const names = new Map(owners.map(owner => [owner.kerb, owner.name]));
        res.status(200).json({
            result: "success",
            data: requests.map(request => ({ ...request, requesterName: names.get(request.requester) ?? request.requester }))
        })
    })

    app.get("/api/quests/:id", async (req, res, next) => {
        if (!req.isAuthenticated()) return res.status(401).json({ msg: "You need to log in first" });
        if (!/^[0-9a-fA-F]{24}$/.test(req.params.id)) return res.status(400).json({ msg: "Invalid quest ID" });
        try {
            const quest = await db.getQuestForViewer(req.params.id, req.user.kerb);
            if (!quest) return res.status(404).json({ msg: "Quest not found or no longer available." });
            const kerbs = [quest.requester, quest.helper].filter(Boolean);
            const users = await db.users.find({ kerb: { $in: kerbs } }, { projection: { kerb: 1, name: 1 } }).toArray();
            const names = new Map(users.map(user => [user.kerb, user.name]));
            res.json({ data: { ...quest, requesterName: names.get(quest.requester) ?? quest.requester, helperName: quest.helper ? names.get(quest.helper) ?? quest.helper : null } });
        } catch (error) { next(error); }
    });

     app.get("/api/profile", async (req, res) => {
        if (!req.isAuthenticated()) {
            return res.status(401).json({
                msg: "You need to log in first"
            });
        }

        const [profile, leaderboard] = await Promise.all([db.getUserMetrics(req.user.kerb, true), db.getLeaderboard(null)]);
        if (!profile) return res.status(404).json({ msg: "Profile not found." });
        res.json({
            ...profile,
            rank: leaderboard.findIndex(user => user.kerb === req.user.kerb) + 1,
            reviews: await db.publicReviews(req.user.kerb),
        });
    });

    app.get("/api/user-profiles/:kerb", async (req, res, next) => {
        if (!req.isAuthenticated()) return res.status(401).json({ msg: "You need to log in first." });
        if (!/^[a-zA-Z0-9_-]{1,64}$/.test(req.params.kerb)) return res.status(400).json({ msg: "Invalid username." });
        try {
            if (await db.isBlockedEitherWay(req.user.kerb, req.params.kerb)) return res.status(404).json({ msg: "Profile not found." });
            const profile = await db.getUserMetrics(req.params.kerb, req.params.kerb === req.user.kerb);
            if (!profile) return res.status(404).json({ msg: "Profile not found." });
            const { kerb, name, createdAt, identityVerificationStatus, postedQuests, completedQuests, confirmedPayments, paymentConfirmationRate, totalConfirmedEarningsCents, rating, reviewCount, reviews, preferredPaymentMethod, paymentInstructions, moderationStatus, strikes } = profile;
            res.json({ kerb, name, createdAt, identityVerificationStatus, postedQuests, completedQuests, confirmedPayments, paymentConfirmationRate, totalConfirmedEarningsCents, rating, reviewCount, ...(req.params.kerb === req.user.kerb ? { preferredPaymentMethod, paymentInstructions, moderationStatus, strikes, reviews } : { reviews: await db.publicReviews(req.params.kerb) }) });
        } catch (error) { next(error); }
    });

    app.post("/api/payment-preference", async (req, res) => {
        if (rateLimited(req, res, "payment-preference", 20)) return;
        if (!req.isAuthenticated()) return res.status(401).json({ msg: "You need to log in first." });
        const { method, instructions } = req.body ?? {};
        if (!DBController.PAYMENT_METHODS.includes(method) || typeof instructions !== "string" || instructions.length > 160) {
            return res.status(400).json({ msg: "Choose a supported external payment method and keep instructions under 160 characters." });
        }
        await db.updatePaymentPreference(req.user.kerb, method, sanitizeText(instructions, 160));
        res.json({ result: "success", msg: "Payment preference saved. It will be shared only with an accepted quest requester." });
    });

    app.get("/api/admin/status", (req, res) => {
        res.json({ isAdmin: Boolean(req.isAuthenticated() && adminKerbs().has(req.user.kerb)) });
    });

    app.get("/api/admin/queue", async (req, res, next) => {
        if (!requireAdmin(req, res)) return;
        try { res.json(await db.adminQueue()); }
        catch (error) { next(error); }
    });

    app.post("/api/admin/disputes/:id/resolve", async (req, res, next) => {
        if (rateLimited(req, res, "admin-dispute", 30)) return;
        if (!requireAdmin(req, res)) return;
        if (!/^[0-9a-fA-F]{24}$/.test(req.params.id)) return res.status(400).json({ msg: "Invalid dispute ID." });
        const { outcome, decision } = req.body ?? {};
        const cleanDecision = sanitizeText(decision, 2000);
        if (!["restore", "cancel"].includes(outcome) || !cleanDecision) return res.status(400).json({ msg: "Choose an outcome and record an administrative decision." });
        try {
            const result = await db.resolveDispute(req.params.id, req.user.kerb, outcome, cleanDecision);
            if (!result) return res.status(409).json({ msg: "This dispute can no longer be resolved." });
            res.json({ result: "success" });
        } catch (error) { next(error); }
    });

    app.post("/api/admin/reports/:id/resolve", async (req, res, next) => {
        if (rateLimited(req, res, "admin-report", 30)) return;
        if (!requireAdmin(req, res)) return;
        if (!/^[0-9a-fA-F]{24}$/.test(req.params.id)) return res.status(400).json({ msg: "Invalid report ID." });
        const decision = sanitizeText(req.body?.decision, 2000);
        if (!decision) return res.status(400).json({ msg: "Record a review decision." });
        try {
            const report = await db.resolveUserReport(req.params.id, req.user.kerb, decision);
            if (!report) return res.status(409).json({ msg: "This report was already reviewed." });
            res.json({ result: "success" });
        } catch (error) { next(error); }
    });

    app.post("/api/admin/users/:kerb/moderate", async (req, res, next) => {
        if (rateLimited(req, res, "admin-moderation", 30)) return;
        if (!requireAdmin(req, res)) return;
        if (!/^[a-zA-Z0-9_-]{1,64}$/.test(req.params.kerb)) return res.status(400).json({ msg: "Invalid username." });
        const note = sanitizeText(req.body?.note, 1000);
        try {
            const result = await db.moderateUser(req.params.kerb, req.user.kerb, req.body?.action, note);
            if (!result) return res.status(404).json({ msg: "User not found or moderation action is invalid." });
            res.json({ result: "success", data: result });
        } catch (error) { next(error); }
    });

    app.post("/api/admin/reports/:id/moderate", async (req, res, next) => {
        if (rateLimited(req, res, "admin-report-moderation", 30)) return;
        if (!requireAdmin(req, res)) return;
        if (!/^[0-9a-fA-F]{24}$/.test(req.params.id) || !/^[a-zA-Z0-9_-]{1,64}$/.test(req.body?.target ?? "")) return res.status(400).json({ msg: "Invalid report or user." });
        const note = sanitizeText(req.body?.note, 1000);
        const decision = sanitizeText(req.body?.decision, 2000);
        if (!note || !decision) return res.status(400).json({ msg: "Record an administrative note and decision." });
        try {
            const result = await db.moderateUserFromReport(req.params.id, req.user.kerb, req.body.target, req.body.action, note, decision);
            if (!result) return res.status(409).json({ msg: "This report was already reviewed or the action is invalid." });
            res.json({ result: "success", data: result });
        } catch (error) { next(error); }
    });

    app.get("/api/users/search", async (req, res, next) => {
        if (rateLimited(req, res, "user-search", 60)) return;
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
        if (rateLimited(req, res, "feedback", 10, 60 * 60 * 1000)) return;
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
        try { res.json({ data: (await db.getLeaderboard(req.user.kerb)).slice(0, 5) }); }
        catch (error) { next(error); }
    });

    app.get("/api/requests/:id/messages", async (req, res, next) => {
        if (!req.isAuthenticated()) return res.status(401).json({ msg: "You need to log in first" });
        if (!/^[0-9a-fA-F]{24}$/.test(req.params.id)) return res.status(400).json({ msg: "Invalid request ID" });
        try {
            const request = await db.getRequestById(req.params.id);
            if (!request?.helper || ![request.requester, request.helper].includes(req.user.kerb)) return res.status(403).json({ msg: "Chat is available after a quest has been accepted, to the requester and assigned completer." });
            if (await db.isBlockedEitherWay(request.requester, request.helper)) return res.status(403).json({ msg: "Messaging is unavailable between these users." });
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
            if (!request?.helper || ![request.requester, request.helper].includes(req.user.kerb)) return res.status(403).json({ msg: "Chat is available after a quest has been accepted, to the requester and assigned completer." });
            if (await db.isBlockedEitherWay(request.requester, request.helper)) return res.status(403).json({ msg: "Messaging is unavailable between these users." });
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

    app.get("/api/my-quests", async (req, res, next) => {
        if (!req.isAuthenticated()) return res.status(401).json({ msg: "You need to log in first" });
        try { res.json({ data: await db.getMyQuests(req.user.kerb) }); }
        catch (error) { next(error); }
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
        if (rateLimited(req, res, "accept-quest", 20)) return;
        if (!req.isAuthenticated()) {
            res.status(401).json({
                result: "fail",
                msg: "You need to log in first"
            })
            return;
        }
        if (await db.userIsSuspended(req.user.kerb)) return res.status(403).json({ result: "fail", msg: "Your account is suspended and cannot accept quests." });
        try {
            const _id = req.body._id;
            if (typeof _id !== "string" || !/^[0-9a-fA-F]{24}$/.test(_id)) return res.status(400).json({ result: "fail", msg: "Invalid request ID" });
            const request = await db.getRequestById(_id);
            const connected = await db.connectRequest(_id, req.user.kerb);
            if (!connected) return res.status(409).json({ result: "fail", msg: "This quest is unavailable, expired, or blocked between these users." });
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
        if (rateLimited(req, res, "quest-progress", 30)) return;
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
        if (rateLimited(req, res, "quest-cancel", 15)) return;
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
                    : `${req.user.name || req.user.kerb} cancelled their assignment for “${request.description}”. The quest is closed.`, requestId: req.params.id,
            });
            res.json({ result: "success" });
        } catch (error) { next(error); }
    });

    app.post("/api/requests/:id/completion", async (req, res, next) => {
        if (rateLimited(req, res, "quest-completion", 15)) return;
        if (!req.isAuthenticated()) return res.status(401).json({ msg: "You need to log in first." });
        if (!/^[0-9a-fA-F]{24}$/.test(req.params.id)) return res.status(400).json({ msg: "Invalid quest ID." });
        const description = sanitizeText(req.body?.description, 2000);
        const evidence = sanitizeText(req.body?.evidence, 4000);
        if (!description) return res.status(400).json({ msg: "Describe the completed work before submitting it for review." });
        try {
            const quest = await db.submitCompletion(req.params.id, req.user.kerb, description, evidence);
            if (!quest) return res.status(409).json({ msg: "Only the assigned completer can submit completion while the quest is in progress." });
            await db.addNotification(quest.requester, { type: "pending_review", title: "Quest ready for review", message: `${req.user.name || req.user.kerb} submitted completion for “${quest.title ?? quest.description}”.`, requestId: req.params.id });
            res.json({ result: "success", status: quest.status });
        } catch (error) { next(error); }
    });

    app.post("/api/requests/:id/approve-completion", async (req, res, next) => {
        if (rateLimited(req, res, "quest-approval", 15)) return;
        if (!req.isAuthenticated()) return res.status(401).json({ msg: "You need to log in first." });
        if (!/^[0-9a-fA-F]{24}$/.test(req.params.id)) return res.status(400).json({ msg: "Invalid quest ID." });
        try {
            const quest = await db.approveCompletion(req.params.id, req.user.kerb);
            if (!quest) return res.status(409).json({ msg: "Only the requester can approve a submitted completion." });
            await db.addNotification(quest.helper, { type: "awaiting_payment", title: "Completion approved", message: `The requester approved “${quest.title ?? quest.description}”. Arrange the external reward payment.`, requestId: req.params.id });
            res.json({ result: "success", status: quest.status });
        } catch (error) { next(error); }
    });

    app.post("/api/requests/:id/payment-sent", async (req, res, next) => {
        if (rateLimited(req, res, "payment-sent", 15)) return;
        if (!req.isAuthenticated()) return res.status(401).json({ msg: "You need to log in first." });
        if (!/^[0-9a-fA-F]{24}$/.test(req.params.id)) return res.status(400).json({ msg: "Invalid quest ID." });
        try {
            const quest = await db.markPaymentSent(req.params.id, req.user.kerb);
            if (!quest) return res.status(409).json({ msg: "Only the requester can mark payment sent after approving completion." });
            await db.addNotification(quest.helper, { type: "payment_sent", title: "Requester says payment was sent", message: `The requester marked the reward as sent for “${quest.title ?? quest.description}”. Confirm only after you receive it.`, requestId: req.params.id });
            res.json({ result: "success", status: quest.status, verified: false });
        } catch (error) { next(error); }
    });

    app.post("/api/requests/:id/confirm-payment", async (req, res, next) => {
        if (rateLimited(req, res, "payment-confirmation", 15)) return;
        if (!req.isAuthenticated()) return res.status(401).json({ msg: "You need to log in first." });
        if (!/^[0-9a-fA-F]{24}$/.test(req.params.id)) return res.status(400).json({ msg: "Invalid quest ID." });
        try {
            const quest = await db.confirmPaymentReceived(req.params.id, req.user.kerb);
            if (!quest) return res.status(409).json({ msg: "Only the assigned completer can confirm receipt after payment was marked sent." });
            await db.addNotification(quest.requester, { type: "completed", title: "Payment receipt confirmed", message: `The completer confirmed receiving the external reward for “${quest.title ?? quest.description}”.`, requestId: req.params.id });
            res.json({ result: "success", status: quest.status, selfReportedByCompleter: true });
        } catch (error) { next(error); }
    });

    app.post("/api/requests/:id/disputes", async (req, res, next) => {
        if (rateLimited(req, res, "quest-dispute", 10, 60 * 60 * 1000)) return;
        if (!req.isAuthenticated()) return res.status(401).json({ msg: "You need to log in first." });
        if (!/^[0-9a-fA-F]{24}$/.test(req.params.id)) return res.status(400).json({ msg: "Invalid quest ID." });
        const { reason } = req.body ?? {};
        const description = sanitizeText(req.body?.description, 2000);
        const evidence = sanitizeText(req.body?.evidence, 4000);
        if (!DBController.DISPUTE_REASONS.includes(reason) || !description) return res.status(400).json({ msg: "Choose a dispute reason and explain the issue." });
        try {
            const dispute = await db.openDispute(req.params.id, req.user.kerb, reason, description, evidence);
            if (!dispute) return res.status(409).json({ msg: "Only quest participants can dispute an active transaction." });
            const other = dispute.reporter === dispute.requester ? dispute.completer : dispute.requester;
            await db.addNotification(other, { type: "disputed", title: "Quest disputed", message: `A participant opened a dispute for quest ${req.params.id}.`, requestId: req.params.id });
            res.status(201).json({ result: "success", disputeId: String(dispute._id) });
        } catch (error) { next(error); }
    });

    app.post("/api/quests/:id/reviews", async (req, res, next) => {
        if (rateLimited(req, res, "quest-review", 20)) return;
        if (!req.isAuthenticated()) return res.status(401).json({ msg: "You need to log in first." });
        if (!/^[0-9a-fA-F]{24}$/.test(req.params.id)) return res.status(400).json({ msg: "Invalid quest ID." });
        const ratings = req.body?.ratings;
        const text = sanitizeText(req.body?.text, 1000);
        if (!ratings || typeof ratings !== "object" || Array.isArray(ratings) || Object.values(ratings).some(value => !Number.isInteger(value) || value < 1 || value > 5)) return res.status(400).json({ msg: "Use a 1–5 star rating for each category." });
        try {
            const review = await db.submitReview(req.params.id, req.user.kerb, ratings, text);
            if (!review) return res.status(403).json({ msg: "Reviews are available to the two participants after payment receipt is confirmed." });
            res.status(201).json({ result: "success", data: { id: String(review._id), createdAt: review.createdAt } });
        } catch (error) {
            if (error.code === 11000) return res.status(409).json({ msg: "You have already reviewed this quest." });
            next(error);
        }
    });

    app.get("/api/quests/:id/review-status", async (req, res, next) => {
        if (!req.isAuthenticated()) return res.status(401).json({ msg: "You need to log in first." });
        if (!/^[0-9a-fA-F]{24}$/.test(req.params.id)) return res.status(400).json({ msg: "Invalid quest ID." });
        try {
            const quest = await db.getRequestById(req.params.id);
            if (!quest || ![quest.requester, quest.helper].includes(req.user.kerb)) return res.status(403).json({ msg: "Only quest participants can view review status." });
            res.json({ reviewed: await db.hasReviewed(req.params.id, req.user.kerb) });
        } catch (error) { next(error); }
    });

    app.post("/api/user-reports", async (req, res, next) => {
        if (rateLimited(req, res, "user-report", 10, 60 * 60 * 1000)) return;
        if (!req.isAuthenticated()) return res.status(401).json({ msg: "You need to log in first." });
        const subject = req.body?.subject;
        const reason = req.body?.reason;
        const description = sanitizeText(req.body?.description, 2000);
        const evidence = sanitizeText(req.body?.evidence, 4000);
        if (typeof subject !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(subject) || !DBController.USER_REPORT_REASONS.includes(reason) || !description) return res.status(400).json({ msg: "Choose a reason and describe the report." });
        try {
            const report = await db.createUserReport(req.user.kerb, subject, reason, description, evidence);
            if (!report) return res.status(400).json({ msg: "You cannot report yourself or an unknown user." });
            res.status(201).json({ result: "success", msg: "Report submitted for review. A report alone does not result in an automatic penalty." });
        } catch (error) { next(error); }
    });

    app.get("/quests/:id", (req, res) => {
        if (!/^[0-9a-fA-F]{24}$/.test(req.params.id)) return res.status(404).end();
        res.sendFile(path.resolve("../frontend/index.html"));
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
