import express from "express";
import DBController from "./db-connect.js";
import passport from "passport";
import {Strategy as LocalStrategy} from "passport-local";
import session from "express-session";
import argon2 from "argon2";
import dotenv from "dotenv";
import MongoStore from "connect-mongo";
import path from "path";
import { createHash, timingSafeEqual } from "node:crypto";
import locationService from "./location-service.js";
import auth from "./auth.js";
import inputValidation from "./validation.js";
import { MAX_MESSAGE_IMAGES, receiveImage, sanitizeImage } from "./image-upload.js";
import moderationPolicy from "./moderation-policy.js";
dotenv.config();

const sessionSecret = process.env.SESSION_SECRET || process.env.SECRET;
if (typeof sessionSecret !== "string" || sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET (or legacy SECRET) must contain at least 32 characters before the API can start.");
}

const app = express();
const production = process.env.NODE_ENV === "production";
const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const databaseName = process.env.MONGODB_DB_NAME || "sidequest";
const db = new DBController();
const mongoClientPromise = db.connectionPromise ?? (db.connectionPromise = db.client.connect());
const sessionStore = MongoStore.create({
    clientPromise: mongoClientPromise,
    dbName: databaseName,
    collectionName: "sessions",
    ttl: 30 * 24 * 60 * 60,
});
const sessionCookie = { httpOnly: true, sameSite: "lax", secure: production, path: "/" };
const rememberDuration = 30 * 24 * 60 * 60 * 1000;
const { attachAuthenticatedUser, requireAuthentication, isQuestParticipant } = auth;
const { schemas, parseReward } = inputValidation;

app.disable("x-powered-by");
app.set("trust proxy", production ? 1 : false);
app.get("/health/live", (_req, res) => res.status(200).json({ status: "ok" }));
app.get("/health/ready", async (_req, res) => {
    const missingConfiguration = [];
    if (!process.env.MONGODB_URI) missingConfiguration.push("MONGODB_URI");
    if (!sessionSecret) missingConfiguration.push("SESSION_SECRET");
    if (production && !(process.env.APP_BASE_URL || process.env.FRONTEND_URL || process.env.FRONTEND_ORIGIN)) missingConfiguration.push("APP_BASE_URL");
    if (production && !process.env.BACKGROUND_JOB_SECRET) missingConfiguration.push("BACKGROUND_JOB_SECRET");
    let database = "unavailable";
    try { await db.ping(); database = "connected"; } catch { /* Keep diagnostics safe and concise. */ }
    let sessionStorage = "unavailable";
    try { await new Promise((resolve, reject) => sessionStore.get("__sidequest_readiness_probe__", error => error ? reject(error) : resolve())); sessionStorage = "ready"; } catch { /* Avoid leaking database diagnostics. */ }
    const ready = database === "connected" && sessionStorage === "ready" && missingConfiguration.length === 0;
    res.status(ready ? 200 : 503).json({ status: ready ? "ready" : "not_ready", checks: { database, sessionStore: sessionStorage, backgroundJobs: production ? (process.env.BACKGROUND_JOB_SECRET ? "configured" : "not_configured") : "local_interval" }, missingConfiguration });
});
app.use((_req, res, next) => {
    res.set("X-Content-Type-Options", "nosniff");
    res.set("X-Frame-Options", "DENY");
    res.set("Referrer-Policy", "strict-origin-when-cross-origin");
    res.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(self)");
    if (production) res.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    next();
});

app.use(express.json({ limit: "256kb" }));
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
        if (req.method === "POST" && req.path === "/internal/background-jobs" && backgroundJobAuthorized(req)) return next();
        const allowedOrigins = new Set();
        for (const value of [process.env.APP_BASE_URL, process.env.FRONTEND_URL, process.env.FRONTEND_ORIGIN]) {
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
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: sessionCookie,
    store: sessionStore,
}));
app.use(passport.initialize());
app.use(passport.session());
app.use("/api", attachAuthenticatedUser);
app.use("/api", (req, res, next) => {
    const publicRoute = (req.method === "GET" && ["/auth-status", "/admin/status"].includes(req.path))
        || (req.method === "POST" && ["/login", "/signup"].includes(req.path))
        || (req.method === "POST" && req.path === "/internal/background-jobs")
        || (req.method === "DELETE" && req.path === "/logout");
    return publicRoute ? next() : requireAuthentication(req, res, next);
});
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
    done(null, `id:${String(user._id)}`);
})
passport.deserializeUser(async (identityId, done) => {
    try {
        const user = typeof identityId === "string" && identityId.startsWith("id:")
            ? await db.findUserById(identityId.slice(3))
            : await db.findUser(identityId); // Existing sessions stored the Kerberos alias.
        return done(null, user || false);
    } catch (e) {
        return done(e);
    }
})
const { sanitizeText } = DBController;
let dummyPasswordHash;

function backgroundJobAuthorized(req) {
    const secret = process.env.BACKGROUND_JOB_SECRET;
    const supplied = req.get("authorization") ?? "";
    const expected = secret ? `Bearer ${secret}` : "";
    const suppliedBuffer = Buffer.from(supplied);
    const expectedBuffer = Buffer.from(expected);
    return Boolean(secret && suppliedBuffer.length === expectedBuffer.length && timingSafeEqual(suppliedBuffer, expectedBuffer));
}

function adminKerbs() {
    return new Set((process.env.ADMIN_KERBS ?? "").split(",").map(value => value.trim()).filter(Boolean));
}

function moderatorKerbs() {
    return new Set([...(process.env.MODERATOR_KERBS ?? "").split(","), ...adminKerbs()].map(value => value.trim()).filter(Boolean));
}

function requireAdmin(req, res) {
    if (!req.auth) return false; // Authentication is enforced by the API middleware.
    if (!req.auth.roles.some(role => ["admin", "moderator"].includes(role)) && !moderatorKerbs().has(req.auth.kerb)) {
        res.status(403).json({ msg: "Moderator access is required." });
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
    const reconcileQuestLifecycle = () => db.reconcileQuestLifecycle()
        .then(result => {
            if (result.newlyExpired) console.log(`Expired ${result.newlyExpired} quest(s) past their deadline.`);
            if (result.archived) console.log(`Archived ${result.archived} expired quest(s) after their grace period.`);
            return result;
        })
        .then(async result => {
            const published = await db.publishDueReviews();
            const reminders = await db.dueReviewReminders();
            if (published) console.log(`Published ${published} quest review(s) after the blind review window.`);
            if (reminders) console.log(`Sent ${reminders} quest review reminder(s).`);
            const removed = await db.cleanupUnattachedImages();
            if (removed) console.log(`Removed ${removed} unattached image(s).`);
            return result;
        })
        .catch(error => console.error("Quest lifecycle reconciliation failed:", error.name));
    void reconcileQuestLifecycle();
    let questCleanupTimer = null;
    if (!production) {
        questCleanupTimer = setInterval(() => { void reconcileQuestLifecycle(); }, 60 * 1000);
        questCleanupTimer.unref();
    }

    app.get("/api/auth-status", (req, res) => {
        res.json({
            isLoggedIn: req.isAuthenticated(),
            name: req.user?.name ?? "",
            kerb: req.user?.kerb ?? "",
            identityVerificationStatus: req.auth?.identityVerificationStatus ?? "unverified",
        });
    });

    app.post("/api/internal/background-jobs", async (req, res, next) => {
        if (!process.env.BACKGROUND_JOB_SECRET) return res.status(503).json({ msg: "Background job authentication is not configured." });
        if (!backgroundJobAuthorized(req)) return res.status(401).json({ msg: "Unauthorized." });
        try {
            const lifecycle = await db.reconcileQuestLifecycle();
            const publishedReviews = await db.publishDueReviews();
            const reviewReminders = await db.dueReviewReminders();
            const removedImages = await db.cleanupUnattachedImages();
            return res.json({ status: "completed", lifecycle, publishedReviews, reviewReminders, removedImages });
        } catch (error) { return next(error); }
    });

    app.post("/api/images", (req, res, next) => {
        if (!req.isAuthenticated()) return res.status(401).json({ msg: "You need to log in first." });
        if (rateLimited(req, res, "image-upload", 12, 10 * 60 * 1000)) return;
        const purpose = req.query.purpose;
        if (!["quest", "completion", "message"].includes(purpose)) return res.status(400).json({ msg: "Choose a valid image purpose." });
        receiveImage(req, res, async () => {
            try {
                if (!req.file) return res.status(400).json({ msg: "Choose an image to upload." });
                const sanitized = await sanitizeImage(req.file);
                const stored = await db.storeSanitizedImage(req.auth, purpose, sanitized);
                return res.status(201).json({ data: stored });
            } catch (error) {
                if (error?.statusCode) return res.status(error.statusCode).json({ msg: error.message });
                if (error?.code === "IMAGE_STORAGE_LIMIT") return res.status(413).json({ msg: error.message });
                return next(error);
            }
        });
    });

    app.get("/api/images/:id", async (req, res, next) => {
        if (!req.isAuthenticated()) return res.status(401).end();
        if (!schemas.objectId(req.params.id)) return res.status(404).end();
        try {
            const image = await db.getImageForViewer(req.params.id, req.auth);
            if (!image) return res.status(404).end();
            const bytes = Buffer.isBuffer(image.bytes) ? image.bytes : Buffer.from(image.bytes?.value?.(true) ?? []);
            if (!bytes.length) return res.status(404).end();
            res.set({
                "Content-Type": "image/webp",
                "Content-Length": String(bytes.length),
                "Content-Disposition": `inline; filename="${image._id}.webp"`,
                "X-Content-Type-Options": "nosniff",
                "Cross-Origin-Resource-Policy": "same-origin",
                "Cache-Control": "private, no-store",
            });
            return res.send(bytes);
        } catch (error) { return next(error); }
    });


    app.post("/api/resolve-address", async (req, res) => {
        if (rateLimited(req, res, "resolve-address", 10, 60 * 1000)) return;
        if (!req.isAuthenticated()) return res.status(401).json({ msg: "You need to log in first." });
        const text = typeof req.body?.address === "string" ? req.body.address : "";
        const roomNumber = typeof req.body?.roomNumber === "string" ? req.body.roomNumber : "";
        try {
            const result = await locationService.geocodeLegacyAddress(text, roomNumber);
            if (result.error) return res.status(422).json({ msg: result.error });
            if (result.needsConfirmation) return res.status(409).json({ needsConfirmation: true, suggestions: result.suggestions });
            return res.json({ data: result.location });
        } catch (error) { return res.status(502).json({ msg: error.message || "The location service is temporarily unavailable." }); }
    });

    app.post("/api/post-request", async (req, res, next) => {
        if (rateLimited(req, res, "post-request", 8, 60 * 60 * 1000)) return;
        if (!req.isAuthenticated()) return res.status(401).json({ result: "fail", msg: "You need to log in first" });
        const idempotencyKey = req.get("Idempotency-Key");
        if (typeof idempotencyKey !== "string" || !/^[A-Za-z0-9_-]{16,100}$/.test(idempotencyKey)) return res.status(400).json({ msg: "A valid request key is required. Refresh the form and try again." });
        const body = req.body ?? {};
        const { description, category, pay, start, end, paymentMethod } = body;
        const rewardCents = parseReward(pay) ?? NaN;
        if (!schemas.category(category)) return res.status(400).json({ result: "fail", msg: "Choose a quest category." });
        if (!schemas.paymentMethod(paymentMethod)) return res.status(400).json({ result: "fail", msg: "Choose a payment method." });
        if (!schemas.boundedText(description, 150)
            || !Number.isFinite(pay) || !Number.isSafeInteger(rewardCents) || rewardCents < 300 || rewardCents / 100 !== pay) {
            return res.status(400).json({ result: "fail", msg: `Enter a description and a reward from $3.00 through $${(inputValidation.MAX_REWARD_CENTS / 100).toFixed(2)}.` });
        }
        const questStart = start == null ? new Date().toISOString() : start;
        const startMs = schemas.isoDateTime(questStart) ? Date.parse(questStart) : NaN;
        const endMs = schemas.isoDateTime(end) ? Date.parse(end) : NaN;
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || !(endMs > startMs) || endMs <= Date.now()) return res.status(400).json({ result: "fail", msg: "Choose a future deadline." });
        if (Object.prototype.hasOwnProperty.call(body, "imageUrl")) return res.status(400).json({ msg: "Upload the quest image first, then submit its image ID." });
        const imageId = body.imageId == null || body.imageId === "" ? "" : String(body.imageId);
        if (imageId && (!schemas.objectId(imageId) || !await db.getOwnedImage(imageId, req.auth, "quest"))) return res.status(400).json({ msg: "Upload a valid quest image before posting." });

        let suspended, pickupResult, dropoffResult;
        try {
            [suspended, pickupResult, dropoffResult] = await Promise.all([
                db.userIsSuspended(req.auth),
                locationService.resolveLocation(body.pickupLocation ?? body.pickup),
                locationService.resolveLocation(body.dropoffLocation ?? body.dropoff),
            ]);
        } catch (error) {
            if (error?.name === "TimeoutError" || error?.name === "AbortError") return res.status(502).json({ msg: "The location service timed out. Please try again." });
            if (error instanceof TypeError) return res.status(502).json({ msg: "The location service is unavailable. Please try again." });
            return next(error);
        }
        if (suspended) return res.status(403).json({ result: "fail", msg: "Your account is suspended and cannot post quests." });
        if (pickupResult.needsConfirmation || dropoffResult.needsConfirmation) {
            return res.status(409).json({ needsConfirmation: true, msg: "Confirm the pickup and drop-off locations from the suggestions.", pickupSuggestions: pickupResult.suggestions ?? [], dropoffSuggestions: dropoffResult.suggestions ?? [] });
        }
        if (pickupResult.error || dropoffResult.error) return res.status(422).json({ msg: pickupResult.error || dropoffResult.error });
        const pickupLocation = pickupResult.location;
        const dropoffLocation = dropoffResult.location;
        const policyError = [pickupLocation, dropoffLocation].some(location => /\b(steam tunnels?|hvac|rooftops?|domes?|construction sites?|locked (?:office|lab|laboratory|room|building|area)|private (?:area|building|residence))\b/i.test(`${location.formattedAddress} ${location.roomNumber ?? ""}`));
        if (policyError) return res.status(400).json({ msg: "Choose an accessible public address. Restricted or locked locations cannot be used." });
        if ([pickupLocation, dropoffLocation].some(location => /\bresidence hall\b/i.test(location.formattedAddress) && !/\b(front desk|lobby|authorized entrance)\b/i.test(`${location.formattedAddress} ${location.roomNumber ?? ""}`))) return res.status(400).json({ msg: "For residence halls, meet at the lobby or front desk unless you have authorization to enter." });
        const cleanDescription = sanitizeText(description, 150);
        const payload = {
            requester: req.user.kerb,
            requesterId: req.auth.userId,
            description: cleanDescription,
            title: summarizeQuestTitle(cleanDescription),
            category,
            rewardCents,
            paymentMethod,
            start: new Date(startMs).toISOString(),
            end: new Date(endMs).toISOString(),
            pickup: [pickupLocation.formattedAddress, pickupLocation.roomNumber ? `Room ${pickupLocation.roomNumber}` : ""].filter(Boolean).join(", "),
            dropoff: [dropoffLocation.formattedAddress, dropoffLocation.roomNumber ? `Room ${dropoffLocation.roomNumber}` : ""].filter(Boolean).join(", "),
            pickupLocation,
            dropoffLocation,
            lat: pickupLocation.lat,
            lng: pickupLocation.lng,
            ...(imageId ? { imageId } : {}),
            idempotencyKey,
            payloadFingerprint: createHash("sha256").update(JSON.stringify({ cleanDescription, category, rewardCents, paymentMethod, startMs, endMs, pickupLocation, dropoffLocation, imageId })).digest("hex"),
        };
        const screening = moderationPolicy.screenQuest({ title: payload.title, description: payload.description, category, pickup: payload.pickup, dropoff: payload.dropoff, hasImage: Boolean(imageId) });
        if (screening.action === "reject") return res.status(422).json({ msg: "This quest request conflicts with SideQuest’s safety policy. Edit the request to remove the prohibited activity.", categories: screening.categories });
        payload.moderationStatus = screening.action === "review" ? "pending_review" : "approved";
        payload.moderationPolicyVersion = screening.policyVersion;
        payload.moderationCategories = screening.categories;
        payload.moderationSignals = screening.signals.map(({ id, category: signalCategory, confidence }) => ({ id, category: signalCategory, confidence }));
        let request;
        try { request = await db.postRequest(payload); }
        catch (error) { return next(error); }
        if (request?.conflict) return res.status(409).json({ msg: "This request key was already used for a different quest. Refresh the form before submitting again." });
        if (!request) return res.status(403).json({ result: "fail", msg: "Your account is suspended and cannot post quests." });
        const created = request.data ?? request;
        const { idempotencyKey: _idempotencyKey, payloadFingerprint: _payloadFingerprint, requesterId: _requesterId, helperId: _helperId, ...publicRequest } = created;
        return res.status(request.duplicate ? 200 : 201).json({ result: "success", msg: publicRequest.moderationStatus === "pending_review" ? "Quest submitted for moderator review" : "Created quest", data: publicRequest });
    });

    app.put("/api/requests/:id", async (req, res, next) => {
        if (rateLimited(req, res, "edit-request", 30)) return;
        if (!req.isAuthenticated()) return res.status(401).json({ msg: "You need to log in first" });
        if (!schemas.objectId(req.params.id)) return res.status(400).json({ msg: "Invalid request ID" });
        const { description, category, pay, start, end } = req.body ?? {};
        const rewardCents = parseReward(pay) ?? NaN;
        if (!schemas.category(category)) return res.status(400).json({ msg: "Choose a quest category." });
        if (!schemas.boundedText(description, 150)
            || !Number.isFinite(pay) || !Number.isSafeInteger(rewardCents) || rewardCents < 300 || rewardCents / 100 !== pay) {
            return res.status(400).json({ msg: `Enter a description and a reward from $3.00 through $${(inputValidation.MAX_REWARD_CENTS / 100).toFixed(2)}.` });
        }
        const startMs = schemas.isoDateTime(start) ? Date.parse(start) : NaN;
        const endMs = schemas.isoDateTime(end) ? Date.parse(end) : NaN;
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || !(endMs > startMs) || endMs <= Date.now()) return res.status(400).json({ msg: "Choose a future deadline after the start time." });
        try {
            const cleanDescription = sanitizeText(description, 150);
            const currentQuest = await db.getRequestById(req.params.id);
            if (!currentQuest || !isQuestParticipant(currentQuest, req.auth)) return res.status(404).json({ msg: "Quest not found." });
            const screening = moderationPolicy.screenQuest({ title: summarizeQuestTitle(cleanDescription), description: cleanDescription, category, pickup: currentQuest.pickup, dropoff: currentQuest.dropoff, hasImage: false });
            if (screening.action === "reject") return res.status(422).json({ msg: "This quest request conflicts with SideQuest’s safety policy. Edit the request to remove the prohibited activity.", categories: screening.categories });
            const request = await db.updateOpenRequest(req.params.id, req.auth, {
                description: cleanDescription, title: summarizeQuestTitle(cleanDescription), category,
                rewardCents, pay, start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString(), expiresAt: new Date(endMs),
                moderationStatus: screening.action === "review" ? "pending_review" : "approved",
                moderationPolicyVersion: screening.policyVersion, moderationCategories: screening.categories,
                moderationSignals: screening.signals.map(({ id, category: signalCategory, confidence }) => ({ id, category: signalCategory, confidence })),
            });
            if (!request) return res.status(409).json({ msg: "This quest can no longer be edited, or its 24-hour extension window has ended." });
            res.json({ result: "success", data: request });
        } catch (error) { next(error); }
    });

    app.post("/api/requests/:id/extend", async (req, res, next) => {
        if (rateLimited(req, res, "extend-expired-quest", 20)) return;
        if (!req.isAuthenticated()) return res.status(401).json({ msg: "You need to log in first." });
        if (!schemas.objectId(req.params.id)) return res.status(400).json({ msg: "Invalid request ID." });
        const endMs = schemas.isoDateTime(req.body?.end) ? Date.parse(req.body.end) : NaN;
        if (!Number.isFinite(endMs) || endMs <= Date.now()) return res.status(400).json({ msg: "Choose a future deadline." });
        try {
            const request = await db.extendExpiredQuest(req.params.id, req.auth, new Date(endMs).toISOString());
            if (!request) return res.status(409).json({ msg: "Only your expired, unaccepted quest can be extended within its 24-hour grace period." });
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
        const blocked = await db.toggleBlock(req.auth, dest);
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
        if (!schemas.kerb(kerb) || !validCredentials(kerb, password)
            || kerb.trim() !== kerb
            || typeof name !== "string" || !name.trim() || name.trim().length > 100) {
            return res.status(400).json({ result: "fail", msg: "Enter a name and a valid Kerberos username." });
        }
        if (!schemas.password(password)) {
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
        const requests = await db.getAllRequests(req.auth);
        const kerbs = [...new Set(requests.map(request => request.requester).filter(Boolean))];
        const owners = await Promise.all(kerbs.map(async kerb => {
            const profile = await db.getUserMetrics(kerb);
            return profile ? [kerb, profile] : null;
        }));
        const profiles = new Map(owners.filter(Boolean));
        res.status(200).json({
            result: "success",
            data: requests.map(request => {
                const profile = profiles.get(request.requester);
                return { ...request, requesterName: profile?.name ?? request.requester, requesterRating: profile?.rating ?? null, requesterReviewCount: profile?.reviewCount ?? 0 };
            })
        })
    })

    app.get("/api/quests/:id", async (req, res, next) => {
        if (!req.isAuthenticated()) return res.status(401).json({ msg: "You need to log in first" });
        if (!schemas.objectId(req.params.id)) return res.status(400).json({ msg: "Invalid quest ID" });
        try {
            const quest = await db.getQuestForViewer(req.params.id, req.auth);
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

        const [profile, leaderboard] = await Promise.all([db.getUserMetrics(req.auth, true), db.getLeaderboard(null)]);
        if (!profile) return res.status(404).json({ msg: "Profile not found." });
        const { userId: _userId, ...publicProfile } = profile;
        res.json({
            ...publicProfile,
            rank: leaderboard.findIndex(user => user.kerb === req.user.kerb) + 1,
            reviews: await db.publicReviews(profile.userId),
        });
    });

    app.get("/api/user-profiles/:kerb", async (req, res, next) => {
        if (!req.isAuthenticated()) return res.status(401).json({ msg: "You need to log in first." });
        if (!/^[a-zA-Z0-9_-]{1,64}$/.test(req.params.kerb)) return res.status(400).json({ msg: "Invalid username." });
        try {
            if (await db.isBlockedEitherWay(req.auth, req.params.kerb)) return res.status(404).json({ msg: "Profile not found." });
            const [profile, leaderboard] = await Promise.all([
                db.getUserMetrics(req.params.kerb, req.params.kerb === req.user.kerb),
                db.getLeaderboard(null),
            ]);
            if (!profile) return res.status(404).json({ msg: "Profile not found." });
            const { kerb, name, createdAt, identityVerificationStatus, postedQuests, completedQuests, confirmedPayments, paymentConfirmationRate, totalConfirmedEarningsCents, rating, reviewCount, ratingAsRequester, reviewsAsRequester, ratingAsAcceptor, reviewsAsAcceptor, frequentTags, reviews, preferredPaymentMethod, paymentInstructions, moderationStatus, strikes } = profile;
            res.json({ kerb, name, createdAt, rank: leaderboard.findIndex(user => user.kerb === kerb) + 1, identityVerificationStatus, postedQuests, completedQuests, confirmedPayments, paymentConfirmationRate, totalConfirmedEarningsCents, rating, reviewCount, ratingAsRequester, reviewsAsRequester, ratingAsAcceptor, reviewsAsAcceptor, frequentTags, ...(req.params.kerb === req.user.kerb ? { preferredPaymentMethod, paymentInstructions, moderationStatus, strikes, reviews } : { reviews: await db.publicReviews(profile.userId) }) });
        } catch (error) { next(error); }
    });

    app.get("/api/recommendations", async (req, res, next) => {
        if (!req.isAuthenticated()) return res.status(401).json({ msg: "You need to log in first." });
        if (rateLimited(req, res, "recommendations", 30)) return;
        try { res.json({ data: await db.getRecommendations(req.auth) }); }
        catch (error) { next(error); }
    });

    app.post("/api/payment-preference", async (req, res, next) => {
        if (rateLimited(req, res, "payment-preference", 20)) return;
        if (!req.isAuthenticated()) return res.status(401).json({ msg: "You need to log in first." });
        const { method, instructions } = req.body ?? {};
        if (!DBController.PAYMENT_METHODS.includes(method) || typeof instructions !== "string" || instructions.length > 160) {
            return res.status(400).json({ msg: "Choose a supported external payment method and keep instructions under 160 characters." });
        }
        try {
            const saved = await db.updatePaymentPreference(req.auth, method, sanitizeText(instructions, 160));
            if (!saved) return res.status(404).json({ msg: "Your SideQuest account could not be found. Sign in again and retry." });
            return res.json({ result: "success", msg: "Payment preference saved. It will be shared only with an accepted quest requester." });
        } catch (error) { return next(error); }
    });

    app.get("/api/admin/status", (req, res) => {
        res.json({ isAdmin: Boolean(req.auth && (req.auth.roles.some(role => ["admin", "moderator"].includes(role)) || moderatorKerbs().has(req.auth.kerb))) });
    });

    app.get("/api/admin/queue", async (req, res, next) => {
        if (!requireAdmin(req, res)) return;
        try { res.json(await db.adminQueue()); }
        catch (error) { next(error); }
    });

    app.post("/api/admin/quest-moderation/:id/resolve", async (req, res, next) => {
        if (rateLimited(req, res, "admin-quest-moderation", 30)) return;
        if (!requireAdmin(req, res)) return;
        if (!schemas.objectId(req.params.id)) return res.status(400).json({ msg: "Invalid moderation case ID." });
        const { action, decision } = req.body ?? {};
        const cleanDecision = sanitizeText(decision, 2000);
        if (!["approve", "reject"].includes(action) || !cleanDecision) return res.status(400).json({ msg: "Choose approve or reject and record a moderation reason." });
        try {
            const result = await db.resolveQuestModeration(req.params.id, req.auth, action, cleanDecision);
            if (!result) return res.status(409).json({ msg: "This moderation case has already been resolved or the quest is no longer pending." });
            void db.addNotificationOnce(result.requesterId ? { userId: result.requesterId, kerb: result.requester } : result.requester, { type: "quest_moderation", title: action === "approve" ? "Quest approved" : "Quest needs changes", message: action === "approve" ? "Your quest passed moderator review and is now visible." : `Your quest was not approved. ${cleanDecision}`, requestId: result.questId }, `quest-moderation:${result.questId}:${result.moderationStatus}`).catch(error => console.error("Could not queue moderation notification:", error.name));
            return res.json({ result: "success" });
        } catch (error) { next(error); }
    });

    app.post("/api/admin/disputes/:id/resolve", async (req, res, next) => {
        if (rateLimited(req, res, "admin-dispute", 30)) return;
        if (!requireAdmin(req, res)) return;
        if (!schemas.objectId(req.params.id)) return res.status(400).json({ msg: "Invalid dispute ID." });
        const { outcome, decision } = req.body ?? {};
        const cleanDecision = sanitizeText(decision, 2000);
        if (!["restore", "cancel"].includes(outcome) || !cleanDecision) return res.status(400).json({ msg: "Choose an outcome and record an administrative decision." });
        try {
            const result = await db.resolveDispute(req.params.id, req.auth, outcome, cleanDecision);
            if (!result) return res.status(409).json({ msg: "This dispute can no longer be resolved." });
            res.json({ result: "success" });
        } catch (error) { next(error); }
    });

    app.post("/api/admin/reports/:id/resolve", async (req, res, next) => {
        if (rateLimited(req, res, "admin-report", 30)) return;
        if (!requireAdmin(req, res)) return;
        if (!schemas.objectId(req.params.id)) return res.status(400).json({ msg: "Invalid report ID." });
        const decision = sanitizeText(req.body?.decision, 2000);
        if (!decision) return res.status(400).json({ msg: "Record a review decision." });
        try {
            const report = await db.resolveUserReport(req.params.id, req.auth, decision);
            if (!report) return res.status(409).json({ msg: "This report was already reviewed." });
            res.json({ result: "success" });
        } catch (error) { next(error); }
    });

    app.post("/api/admin/review-reports/:id/resolve", async (req, res, next) => {
        if (rateLimited(req, res, "admin-review-report", 30)) return;
        if (!requireAdmin(req, res)) return;
        if (!schemas.objectId(req.params.id)) return res.status(400).json({ msg: "Invalid review report ID." });
        const { action } = req.body ?? {};
        const decision = sanitizeText(req.body?.decision, 2000);
        if (!DBController.REVIEW_REPORT_ACTIONS.includes(action) || !decision) return res.status(400).json({ msg: "Choose an action and record an administrative decision." });
        try {
            const result = await db.resolveReviewReport(req.params.id, req.auth, action, decision);
            if (!result) return res.status(409).json({ msg: "This review report is no longer open." });
            res.json({ result: "success", data: result });
        } catch (error) { next(error); }
    });

    app.post("/api/admin/users/:kerb/moderate", async (req, res, next) => {
        if (rateLimited(req, res, "admin-moderation", 30)) return;
        if (!requireAdmin(req, res)) return;
        if (!/^[a-zA-Z0-9_-]{1,64}$/.test(req.params.kerb)) return res.status(400).json({ msg: "Invalid username." });
        const note = sanitizeText(req.body?.note, 1000);
        try {
            const result = await db.moderateUser(req.params.kerb, req.auth, req.body?.action, note);
            if (!result) return res.status(404).json({ msg: "User not found or moderation action is invalid." });
            res.json({ result: "success", data: result });
        } catch (error) { next(error); }
    });

    app.post("/api/admin/reports/:id/moderate", async (req, res, next) => {
        if (rateLimited(req, res, "admin-report-moderation", 30)) return;
        if (!requireAdmin(req, res)) return;
        if (!schemas.objectId(req.params.id) || !/^[a-zA-Z0-9_-]{1,64}$/.test(req.body?.target ?? "")) return res.status(400).json({ msg: "Invalid report or user." });
        const note = sanitizeText(req.body?.note, 1000);
        const decision = sanitizeText(req.body?.decision, 2000);
        if (!note || !decision) return res.status(400).json({ msg: "Record an administrative note and decision." });
        try {
            const result = await db.moderateUserFromReport(req.params.id, req.auth, req.body.target, req.body.action, note, decision);
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
            res.json({ data: await db.searchUsers(query, req.auth) });
        } catch (error) { next(error); }
    });

    app.get("/api/notifications", async (req, res, next) => {
        if (!req.isAuthenticated()) return res.status(401).json({ msg: "You need to log in first" });
        try { res.json({ data: await db.getNotifications(req.auth) }); }
        catch (error) { next(error); }
    });

    app.patch("/api/notifications/:id/read", async (req, res, next) => {
        if (!req.isAuthenticated()) return res.status(401).json({ msg: "You need to log in first" });
        if (!schemas.objectId(req.params.id)) return res.status(400).json({ msg: "Invalid notification ID" });
        try { await db.markNotificationRead(req.params.id, req.auth); res.json({ result: "success" }); }
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
            await db.submitFeedback(req.auth, kind, message);
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
        if (!schemas.objectId(req.params.id)) return res.status(400).json({ msg: "Invalid request ID" });
        try {
            const request = await db.getRequestById(req.params.id);
            if (!request?.helper || !isQuestParticipant(request, req.auth)) return res.status(403).json({ msg: "Chat is available after a quest has been accepted, to the requester and assigned completer." });
            if (await db.isBlockedEitherWay({ userId: request.requesterId ? String(request.requesterId) : "", kerb: request.requester }, { userId: request.helperId ? String(request.helperId) : "", kerb: request.helper })) return res.status(403).json({ msg: "Messaging is unavailable between these users." });
            const messages = await db.getQuestMessages(req.params.id, typeof req.query.since === "string" ? req.query.since : null);
            res.json({ data: messages.map(message => ({ sender: message.sender, text: message.text, images: (message.imageIds ?? []).map(imageId => `/api/images/${imageId}`), createdAt: message.createdAt, own: message.senderId ? String(message.senderId) === req.auth.userId : message.sender === req.user.kerb })) });
        } catch (error) { next(error); }
    });

    app.post("/api/requests/:id/messages", async (req, res, next) => {
        if (!req.isAuthenticated()) return res.status(401).json({ msg: "You need to log in first" });
        if (!schemas.objectId(req.params.id)) return res.status(400).json({ msg: "Invalid request ID" });
        if (rateLimited(req, res, "quest-message", 60, 60 * 1000)) return;
        const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
        const imageIds = req.body?.imageIds ?? [];
        if ((text && !schemas.boundedText(text, 2000)) || (!text && (!Array.isArray(imageIds) || imageIds.length === 0))
            || !Array.isArray(imageIds) || imageIds.length > MAX_MESSAGE_IMAGES || imageIds.some(id => !schemas.objectId(id))
            || new Set(imageIds).size !== imageIds.length) return res.status(400).json({ msg: `Enter a message under 2,000 characters or attach up to ${MAX_MESSAGE_IMAGES} photos.` });
        try {
            const request = await db.getRequestById(req.params.id);
            if (!request?.helper || !isQuestParticipant(request, req.auth)) return res.status(403).json({ msg: "Chat is available after a quest has been accepted, to the requester and assigned completer." });
            if (await db.isBlockedEitherWay({ userId: request.requesterId ? String(request.requesterId) : "", kerb: request.requester }, { userId: request.helperId ? String(request.helperId) : "", kerb: request.helper })) return res.status(403).json({ msg: "Messaging is unavailable between these users." });
            const message = await db.addQuestMessage(req.params.id, req.auth, text, imageIds);
            const recipient = request.requester === req.user.kerb ? request.helper : request.requester;
            if (recipient) await db.addNotification(recipient, {
                type: "message", title: `Message from ${req.user.name || req.user.kerb}`, message: (text || "Sent a photo.").slice(0, 180), requestId: req.params.id,
            });
            res.status(201).json({ data: { sender: message.sender, text: message.text, images: (message.imageIds ?? []).map(imageId => `/api/images/${imageId}`), createdAt: message.createdAt, own: true } });
        } catch (error) { next(error); }
    });

    app.get("/api/my-requests", async (req, res, next) => {
        if (!req.isAuthenticated()) {
            return res.status(401).json({
                msg: "You need to log in first"
            });
        }

        try {
            const requests = await db.getPostedRequests(req.auth);
            res.json(requests);
        } catch (error) {
            next(error);
        }
    });

    app.get("/api/my-quests", async (req, res, next) => {
        if (!req.isAuthenticated()) return res.status(401).json({ msg: "You need to log in first" });
        try { res.json({ data: await db.getMyQuests(req.auth) }); }
        catch (error) { next(error); }
    });

    app.delete("/api/requests/:id", async (req, res, next) => {
        if (!req.isAuthenticated()) {
            return res.status(401).json({
                msg: "You need to log in first"
            });
        }

        const { id } = req.params;

        if (!schemas.objectId(id)) {
            return res.status(400).json({ msg: "Invalid request ID" });
        }

        try {
            const oldRequest = await db.getRequestById(id);
            const result = await db.deleteRequest(id, req.auth);

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
        if (await db.userIsSuspended(req.auth)) return res.status(403).json({ result: "fail", msg: "Your account is suspended and cannot accept quests." });
        try {
            const _id = req.body._id;
            if (typeof _id !== "string" || !schemas.objectId(_id)) return res.status(400).json({ result: "fail", msg: "Invalid request ID" });
            const request = await db.getRequestById(_id);
            const connected = await db.connectRequest(_id, req.auth);
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
        if (!schemas.objectId(req.params.id)) return res.status(400).json({ msg: "Invalid request ID" });
        const stage = req.body.stage;
        if (stage !== "started" && stage !== "picked_up") return res.status(400).json({ msg: "Invalid quest stage" });
        try {
            const request = await db.updateQuestStage(req.params.id, req.auth, stage);
            if (!request) return res.status(409).json({ msg: "Could not update this quest stage." });
            if (request.requester) await db.addNotification(request.requester, {
                type: stage, title: stage === "started" ? "Quest in progress" : "Pickup complete",
                message: stage === "started" ? `${req.user.name || req.user.kerb} started “${request.description}”.` : `Pickup is complete for “${request.description}”. It is ready for delivery.`, requestId: req.params.id,
            });
            res.json({ result: "success" });
        } catch (error) { next(error); }
    });

    app.post("/api/requests/:id/location", async (req, res, next) => {
        if (rateLimited(req, res, "quest-location", 3, 60 * 1000)) return;
        if (!req.isAuthenticated()) return res.status(401).json({ msg: "You need to log in first." });
        if (!schemas.objectId(req.params.id)) return res.status(400).json({ msg: "Invalid quest ID." });
        const { lat, lng } = req.body ?? {};
        if (!schemas.latitude(lat) || !schemas.longitude(lng)) return res.status(400).json({ msg: "Provide valid location coordinates." });
        try {
            const quest = await db.updateQuestHelperLocation(req.params.id, req.auth, lat, lng);
            if (!quest) return res.status(409).json({ msg: "Only the assigned acceptor can share a location while the quest is in progress." });
            res.json({ result: "success", updatedAt: quest.helperLocation.updatedAt });
        } catch (error) { next(error); }
    });

    app.post("/api/requests/:id/cancel", async (req, res, next) => {
        if (rateLimited(req, res, "quest-cancel", 15)) return;
        if (!req.isAuthenticated()) return res.status(401).json({ msg: "You need to log in first" });
        if (!schemas.objectId(req.params.id)) return res.status(400).json({ msg: "Invalid request ID" });
        const reason = sanitizeText(req.body?.reason, 500) || "No reason provided";
        try {
            const request = await db.cancelQuest(req.params.id, req.auth, reason);
            if (!request) return res.status(409).json({ msg: "This quest can no longer be cancelled." });
            const cancellation = request.lastCancellation;
            const isHelperCancellation = cancellation?.role === "acceptor";
            const recipient = isHelperCancellation
                ? { userId: request.requesterId ? String(request.requesterId) : "", kerb: request.requester }
                : { userId: request.helperId ? String(request.helperId) : "", kerb: request.helper ?? "" };
            if (recipient.kerb || recipient.userId) await db.addNotificationOnce(recipient, {
                type: isHelperCancellation && request.status === "open" ? "quest_reopened" : isHelperCancellation && request.status === "expired" ? "expired" : "cancelled",
                title: isHelperCancellation && request.status === "open" ? "Quest available again" : isHelperCancellation && request.status === "expired" ? "Quest expired" : "Quest cancelled",
                message: isHelperCancellation
                    ? request.status === "open" ? `The acceptor cancelled. Your quest has been reopened: “${request.title ?? request.description}”.`
                        : request.status === "expired" ? `The acceptor cancelled after the deadline. Your quest has expired: “${request.title ?? request.description}”.`
                            : `The acceptor cancelled “${request.title ?? request.description}”. Since work or a payment obligation exists, the quest was not automatically reopened.`
                    : `${req.user.name || req.user.kerb} cancelled “${request.title ?? request.description}”.`,
                requestId: req.params.id,
            }, `quest-cancel:${req.params.id}:${new Date(cancellation.at).getTime()}`);
            res.json({ result: "success", status: request.status, cancellation });
        } catch (error) { next(error); }
    });

    app.post("/api/requests/:id/completion", async (req, res, next) => {
        if (rateLimited(req, res, "quest-completion", 15)) return;
        if (!req.isAuthenticated()) return res.status(401).json({ msg: "You need to log in first." });
        if (!schemas.objectId(req.params.id)) return res.status(400).json({ msg: "Invalid quest ID." });
        const rawEvidence = req.body?.evidence;
        if (typeof rawEvidence !== "string" || rawEvidence.length > 150 || !rawEvidence.trim()) return res.status(400).json({ msg: "Describe the completed work in 150 characters or fewer." });
        const evidence = sanitizeText(rawEvidence, 150);
        if (Object.prototype.hasOwnProperty.call(req.body ?? {}, "imageUrl")) return res.status(400).json({ msg: "Upload the receipt image first, then submit its image ID." });
        const imageId = req.body?.imageId == null || req.body.imageId === "" ? "" : String(req.body.imageId);
        if (imageId && (!schemas.objectId(imageId) || !await db.getOwnedImage(imageId, req.auth, "completion"))) return res.status(400).json({ msg: "Upload a valid receipt image before submitting completion." });
        if (!evidence) return res.status(400).json({ msg: "Describe the completed work in 150 characters or fewer." });
        try {
            const quest = await db.submitRequesterCompletion(req.params.id, req.auth, evidence, imageId);
            if (!quest) return res.status(409).json({ msg: "Only the requester can mark an in-progress quest complete." });
            await db.addNotification(quest.helper, { type: "awaiting_payment", title: "Quest marked complete", message: `The requester marked “${quest.title ?? quest.description}” complete. Arrange the external reward payment.`, requestId: req.params.id });
            res.json({ result: "success", status: quest.status });
        } catch (error) { next(error); }
    });

    app.post("/api/requests/:id/approve-completion", async (req, res, next) => {
        if (rateLimited(req, res, "quest-approval", 15)) return;
        if (!req.isAuthenticated()) return res.status(401).json({ msg: "You need to log in first." });
        if (!schemas.objectId(req.params.id)) return res.status(400).json({ msg: "Invalid quest ID." });
        try {
            const quest = await db.approveCompletion(req.params.id, req.auth);
            if (!quest) return res.status(409).json({ msg: "Only the requester can approve a submitted completion." });
            await db.addNotification(quest.helper, { type: "awaiting_payment", title: "Completion approved", message: `The requester approved “${quest.title ?? quest.description}”. Arrange the external reward payment.`, requestId: req.params.id });
            res.json({ result: "success", status: quest.status });
        } catch (error) { next(error); }
    });

    app.post("/api/requests/:id/payment-sent", async (req, res, next) => {
        if (rateLimited(req, res, "payment-sent", 15)) return;
        if (!req.isAuthenticated()) return res.status(401).json({ msg: "You need to log in first." });
        if (!schemas.objectId(req.params.id)) return res.status(400).json({ msg: "Invalid quest ID." });
        try {
            const quest = await db.markPaymentSent(req.params.id, req.auth);
            if (!quest) return res.status(409).json({ msg: "Only the requester can mark payment sent after approving completion." });
            await db.addNotification(quest.helper, { type: "payment_sent", title: "Requester says payment was sent", message: `The requester marked the reward as sent for “${quest.title ?? quest.description}”. Confirm only after you receive it.`, requestId: req.params.id });
            res.json({ result: "success", status: quest.status, verified: false });
        } catch (error) { next(error); }
    });

    app.post("/api/requests/:id/confirm-payment", async (req, res, next) => {
        if (rateLimited(req, res, "payment-confirmation", 15)) return;
        if (!req.isAuthenticated()) return res.status(401).json({ msg: "You need to log in first." });
        if (!schemas.objectId(req.params.id)) return res.status(400).json({ msg: "Invalid quest ID." });
        try {
            const quest = await db.confirmPaymentReceived(req.params.id, req.auth);
            if (!quest) return res.status(409).json({ msg: "Only the assigned completer can confirm receipt after payment was marked sent." });
            void Promise.all([
                db.addNotificationOnce(quest.requesterId ? { kerb: quest.requester, userId: String(quest.requesterId) } : quest.requester, { type: "completed", title: "Payment receipt confirmed", message: `The completer confirmed receiving the external reward for “${quest.title ?? quest.description}”. You can now leave a review.`, requestId: req.params.id }, `review-eligible:${req.params.id}:${String(quest.requesterId ?? quest.requester)}`),
                db.addNotificationOnce(quest.helperId ? { kerb: quest.helper, userId: String(quest.helperId) } : quest.helper, { type: "review_eligible", title: "Share your quest experience", message: `Your quest “${quest.title ?? quest.description}” is complete. You can leave a review.`, requestId: req.params.id }, `review-eligible:${req.params.id}:${String(quest.helperId ?? quest.helper)}`),
            ]).catch(error => console.error("Could not queue review eligibility notifications:", error.name));
            res.json({ result: "success", status: quest.status, selfReportedByCompleter: true });
        } catch (error) { next(error); }
    });

    app.post("/api/requests/:id/disputes", async (req, res, next) => {
        if (rateLimited(req, res, "quest-dispute", 10, 60 * 60 * 1000)) return;
        if (!req.isAuthenticated()) return res.status(401).json({ msg: "You need to log in first." });
        if (!schemas.objectId(req.params.id)) return res.status(400).json({ msg: "Invalid quest ID." });
        const { reason } = req.body ?? {};
        const description = sanitizeText(req.body?.description, 2000);
        const evidence = sanitizeText(req.body?.evidence, 4000);
        if (!DBController.DISPUTE_REASONS.includes(reason) || !description) return res.status(400).json({ msg: "Choose a dispute reason and explain the issue." });
        try {
            const dispute = await db.openDispute(req.params.id, req.auth, reason, description, evidence);
            if (!dispute) return res.status(409).json({ msg: "Only quest participants can dispute an active transaction." });
            const other = dispute.reporter === dispute.requester ? dispute.completer : dispute.requester;
            await db.addNotification(other, { type: "disputed", title: "Quest disputed", message: `A participant opened a dispute for quest ${req.params.id}.`, requestId: req.params.id });
            res.status(201).json({ result: "success", disputeId: String(dispute._id) });
        } catch (error) { next(error); }
    });

    app.post("/api/quests/:id/reviews", async (req, res, next) => {
        if (rateLimited(req, res, "quest-review", 20)) return;
        if (!req.isAuthenticated()) return res.status(401).json({ msg: "You need to log in first." });
        if (!schemas.objectId(req.params.id)) return res.status(400).json({ msg: "Invalid quest ID." });
        const { rating, tags } = req.body ?? {};
        const text = req.body?.text ?? "";
        if (!Number.isInteger(rating) || rating < 1 || rating > 5 || typeof text !== "string" || text.length > 500 || !Array.isArray(tags) || tags.some(tag => typeof tag !== "string")) return res.status(400).json({ msg: "Choose a 1–5 star rating, valid tags, and a review under 500 characters." });
        try {
            const review = await db.submitReview(req.params.id, req.auth, rating, tags, text);
            if (!review) return res.status(403).json({ msg: "Reviews are available only to the two participants after payment receipt is confirmed." });
            if (review.duplicate) return res.status(409).json({ msg: "You have already reviewed this quest." });
            res.status(201).json({ result: "success", data: { id: String(review._id), createdAt: review.createdAt, published: review.publicationStatus === "published" } });
        } catch (error) {
            if (error.code === 11000) return res.status(409).json({ msg: "You have already reviewed this quest." });
            next(error);
        }
    });

    app.get("/api/quests/:id/review-status", async (req, res, next) => {
        if (!req.isAuthenticated()) return res.status(401).json({ msg: "You need to log in first." });
        if (!schemas.objectId(req.params.id)) return res.status(400).json({ msg: "Invalid quest ID." });
        try {
            const quest = await db.getRequestById(req.params.id);
            if (!quest || ![quest.requester, quest.helper].includes(req.user.kerb)) return res.status(403).json({ msg: "Only quest participants can view review status." });
            res.json(await db.reviewStatus(req.params.id, req.auth));
        } catch (error) { next(error); }
    });

    app.post("/api/reviews/:id/reports", async (req, res, next) => {
        if (rateLimited(req, res, "review-report", 10, 60 * 60 * 1000)) return;
        if (!req.isAuthenticated()) return res.status(401).json({ msg: "You need to log in first." });
        if (!schemas.objectId(req.params.id)) return res.status(400).json({ msg: "Invalid review ID." });
        const { reason } = req.body ?? {};
        const description = sanitizeText(req.body?.description, 1000);
        if (!DBController.REVIEW_REPORT_REASONS.includes(reason) || !description) return res.status(400).json({ msg: "Choose a report reason and describe the concern." });
        try {
            const report = await db.createReviewReport(req.auth, req.params.id, reason, description);
            if (!report) return res.status(403).json({ msg: "You cannot report your own review or a review that is not publicly visible." });
            res.status(201).json({ result: "success", msg: "Review report submitted for moderator review." });
        } catch (error) { if (error.code === 11000) return res.status(409).json({ msg: "You have already reported this review." }); next(error); }
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
            const report = await db.createUserReport(req.auth, subject, reason, description, evidence);
            if (!report) return res.status(400).json({ msg: "You cannot report yourself or an unknown user." });
            res.status(201).json({ result: "success", msg: "Report submitted for review. A report alone does not result in an automatic penalty." });
        } catch (error) { next(error); }
    });

    app.get("/quests/:id", (req, res) => {
        if (!schemas.objectId(req.params.id)) return res.status(404).end();
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

    const server = app.listen(port);
    let shuttingDown = false;
    const shutdown = signal => {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log(`Received ${signal}; closing the API and MongoDB connection.`);
        if (questCleanupTimer) clearInterval(questCleanupTimer);
        server.close(async error => {
            if (error) {
                console.error("API shutdown failed:", error.name);
                process.exitCode = 1;
            }
            try {
                await db.close();
            } catch (closeError) {
                console.error("MongoDB shutdown failed:", closeError.name);
                process.exitCode = 1;
            }
        });
    };
    process.once("SIGINT", () => shutdown("SIGINT"));
    process.once("SIGTERM", () => shutdown("SIGTERM"));
})().catch(async error => {
    console.error("API startup failed:", error.name);
    try {
        await db.close();
    } catch (closeError) {
        console.error("MongoDB cleanup after startup failure failed:", closeError.name);
    }
    process.exitCode = 1;
});
