const { MongoClient, ObjectId } = require("mongodb");
const { canTransition, normalizeQuestStatus, canAccept, cancellationStatus, expirationGraceDeadline, shouldArchiveExpiredQuest } = require("./quest-lifecycle.js");
const { schemas } = require("./validation.js");
const { REVIEW_WINDOW_MS, REVIEW_TAGS, reviewStarValue, isPublishedReview, normalizeTags, reviewWindowEnd } = require("./review-policy.js");
const { moderationMessage } = require("./moderation-policy.js");
require("dotenv").config();

const uri = process.env.MONGODB_URI;
const databaseName = process.env.MONGODB_DB_NAME || "sidequest";
const MAX_USER_IMAGE_STORAGE_BYTES = configuredByteLimit(process.env.MAX_USER_IMAGE_STORAGE_BYTES, 100 * 1024 * 1024, 5 * 1024 * 1024, 2 * 1024 * 1024 * 1024);
const MAX_GLOBAL_IMAGE_STORAGE_BYTES = configuredByteLimit(process.env.MAX_GLOBAL_IMAGE_STORAGE_BYTES, 5 * 1024 * 1024 * 1024, 50 * 1024 * 1024, 100 * 1024 * 1024 * 1024);
const ACTIVE_TRANSACTION_STATES = ["in_progress", "pending_review", "awaiting_payment", "payment_sent"];
const PAYMENT_METHODS = ["Cash", "PayPal", "Venmo", "Cash App", "Zelle", "Other"];
const DISPUTE_REASONS = ["Requester failed to pay", "Completer failed to complete the quest", "Quest requirements were misrepresented", "Payment amount was incorrect", "Harassment or inappropriate behavior", "Other"];
const REVIEW_REPORT_REASONS = ["Harassment", "Spam", "Inappropriate content", "Other"];
const USER_REPORT_REASONS = ["Harassment or inappropriate behavior", "Fraud or misleading conduct", "Spam", "Other"];

function actorIdentity(actor) {
    if (actor instanceof ObjectId) return { userId: String(actor), kerb: "" };
    if (actor && typeof actor === "object") return { userId: typeof actor.userId === "string" ? actor.userId : typeof actor.id === "string" ? actor.id : "", kerb: typeof actor.kerb === "string" ? actor.kerb : "" };
    return { userId: "", kerb: typeof actor === "string" ? actor : "" };
}

function configuredByteLimit(value, fallback, minimum, maximum) {
    const parsed = Number.parseInt(value ?? "", 10);
    return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function imageStorageLimitError(message) {
    const error = new Error(message);
    error.code = "IMAGE_STORAGE_LIMIT";
    return error;
}

function identityClause(actor, idField, kerbField) {
    const { userId, kerb } = actorIdentity(actor);
    const idClause = schemas.objectId(userId) ? { [idField]: new ObjectId(userId) } : null;
    const legacyClause = kerb ? { $and: [{ [idField]: { $in: [null] } }, { [kerbField]: kerb }] } : null;
    if (idClause && legacyClause) return { $or: [idClause, legacyClause] };
    return idClause ?? legacyClause ?? { _id: null };
}

function matchesIdentity(record, actor, idField, kerbField) {
    const { userId, kerb } = actorIdentity(actor);
    if (schemas.objectId(userId) && String(record?.[idField] ?? "") === userId) return true;
    return Boolean(kerb && !record?.[idField] && record?.[kerbField] === kerb);
}

function actorKerb(actor) { return actorIdentity(actor).kerb; }

function sanitizeText(value, maxLength) {
    return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength) : "";
}

function ratingSummary(reviews = []) {
    const published = reviews.filter(isPublishedReview);
    const values = published.map(reviewStarValue).filter(value => Number.isInteger(value) && value >= 1 && value <= 5);
    return {
        rating: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
        reviewCount: values.length,
    };
}

function requestExpiry(request) {
    const dueAt = request.end ?? request.expiresAt;
    if (dueAt != null) {
        const dueMs = dueAt instanceof Date ? dueAt.getTime() : Date.parse(dueAt);
        if (Number.isFinite(dueMs)) return dueMs;
    }
    return request.createdAt ? new Date(request.createdAt).getTime() + 86400000 : Infinity;
}

function publicQuest(request, viewer, viewerIsParty) {
    const rewardCents = Number.isSafeInteger(request.rewardCents) ? request.rewardCents : Math.round(Number(request.pay ?? 0) * 100);
    const expiry = requestExpiry(request);
    const status = normalizeQuestStatus(request.status);
    const result = { ...request, status, rewardCents, pay: rewardCents / 100, expiresAt: Number.isFinite(expiry) ? new Date(expiry) : null, expired: status === "expired" || (status === "open" && expiry <= Date.now()), expirationGraceUntil: request.expirationGraceUntil ?? (Number.isFinite(expiry) ? new Date(expirationGraceDeadline(expiry)) : null) };
    result.moderationStatus = request.moderationStatus ?? "approved";
    if (viewerIsParty && result.moderationStatus !== "approved") result.moderationMessage = request.moderationMessage ?? moderationMessage(result.moderationStatus);
    if (result.imageId instanceof ObjectId) result.imageUrl = `/api/images/${result.imageId}`;
    else delete result.imageUrl;
    if (result.completionReceipt?.imageId instanceof ObjectId) result.completionReceipt.imageUrl = `/api/images/${result.completionReceipt.imageId}`;
    else if (result.completionReceipt) delete result.completionReceipt.imageUrl;
    if (result.helperLocation?.updatedAt && new Date(result.helperLocation.updatedAt).getTime() < Date.now() - 2 * 60 * 1000) delete result.helperLocation;
    delete result.idempotencyKey;
    delete result.payloadFingerprint;
    delete result.reviewSubmissionVersion;
    delete result.moderationSignals;
    if (!viewerIsParty) {
        delete result.moderationPolicyVersion;
        delete result.moderationCategories;
        delete result.moderationMessage;
        delete result.moderationStatus;
    }
    delete result.requesterId;
    delete result.helperId;
    if (!viewerIsParty) {
        delete result.agreementSnapshot;
        delete result.completionSubmission;
        delete result.completionReceipt;
        delete result.statusHistory;
        delete result.disputedFromStatus;
        delete result.helperLocation;
        delete result.paymentSentAt;
        delete result.paymentConfirmedAt;
        delete result.requesterApprovedAt;
    } else if (viewer === request.requester) {
        const paymentInfoMayBeShown = ["awaiting_payment", "payment_sent", "completed"].includes(result.status)
            || (result.status === "disputed" && ["awaiting_payment", "payment_sent"].includes(request.disputedFromStatus));
        if (!paymentInfoMayBeShown && result.agreementSnapshot) result.agreementSnapshot = { ...result.agreementSnapshot, paymentInstructions: "" };
    }
    return result;
}

class DBController {
    constructor() {
        if (!uri) throw new Error("MONGODB_URI is required.");
        this.client = new MongoClient(uri, { family: 4, serverSelectionTimeoutMS: 10000, maxPoolSize: 20, minPoolSize: 0 });
        this.connectionPromise = null;
    }

    async connect() {
        this.connectionPromise ??= this.client.connect();
        await this.connectionPromise;
        this.db = this.client.db(databaseName);
        this.requests = this.db.collection("requests");
        this.users = this.db.collection("users");
        this.messages = this.db.collection("messages");
        this.notifications = this.db.collection("notifications");
        this.feedback = this.db.collection("feedback");
        this.reviews = this.db.collection("questReviews");
        this.reviewReports = this.db.collection("reviewReports");
        this.disputes = this.db.collection("disputes");
        this.reports = this.db.collection("userReports");
        this.adminAudit = this.db.collection("adminAudit");
        this.questModerationCases = this.db.collection("questModerationCases");
        this.images = this.db.collection("images");
        this.imageStorage = this.db.collection("imageStorage");

        await this.users.createIndex({ kerb: 1 }, { unique: true });
        await this.users.createIndex({ identityProvider: 1, externalIdentityId: 1 }, { unique: true, partialFilterExpression: { externalIdentityId: { $type: "string" } }, name: "external_identity" });
        await this.requests.createIndex({ requester: 1, createdAt: -1 });
        await this.requests.createIndex({ requesterId: 1, createdAt: -1 });
        await this.requests.createIndex({ helperId: 1, status: 1 });
        await this.requests.createIndex({ requester: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } }, name: "request_idempotency" });
        await this.requests.createIndex({ requesterId: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" }, requesterId: { $type: "objectId" } }, name: "request_idempotency_by_user" });
        await this.requests.createIndex({ helper: 1, status: 1 });
        await this.requests.createIndex({ expiresAt: 1, status: 1 });
        await this.requests.createIndex({ status: 1, completedAt: 1, paymentConfirmedAt: 1 });
        await this.requests.createIndex({ status: 1, expirationGraceUntil: 1, deletedAt: 1 });
        await this.notifications.createIndex({ kerb: 1, createdAt: -1 });
        await this.notifications.createIndex({ userId: 1, createdAt: -1 });
        await this.notifications.createIndex({ dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: "string" } }, name: "notification_dedupe" });
        await this.reviews.createIndex({ questId: 1, reviewer: 1 }, { unique: true });
        await this.reviews.createIndex({ questId: 1, reviewerId: 1 }, { unique: true, partialFilterExpression: { reviewerId: { $type: "objectId" } }, name: "review_once_by_user" });
        await this.reviews.createIndex({ publicationStatus: 1, targetId: 1, createdAt: -1 });
        await this.reviewReports.createIndex({ status: 1, createdAt: 1 });
        await this.reviewReports.createIndex({ reviewId: 1, reporterId: 1 }, { unique: true, partialFilterExpression: { reporterId: { $type: "objectId" } }, name: "review_report_once_by_user" });
        await this.disputes.createIndex({ status: 1, createdAt: 1 });
        await this.reports.createIndex({ status: 1, createdAt: 1 });
        await this.questModerationCases.createIndex({ status: 1, createdAt: 1 });
        await this.questModerationCases.createIndex({ questId: 1, createdAt: -1 });
        await this.adminAudit.createIndex({ createdAt: -1 });
        await this.images.createIndex({ ownerId: 1, createdAt: -1 });
        await this.images.createIndex({ requestId: 1, purpose: 1 });
        await this.images.createIndex({ requestId: 1, createdAt: 1 });
        await this.imageStorage.updateOne({ _id: "global-image-storage" }, { $setOnInsert: { bytes: 0 } }, { upsert: true });
        await Promise.all([
            this.requests.updateMany({ imageUrl: /^data:image\//i }, { $unset: { imageUrl: "" } }),
            this.requests.updateMany({ "completionReceipt.imageUrl": /^data:image\//i }, { $unset: { "completionReceipt.imageUrl": "" } }),
        ]);
        await this.initializeIdentitySchema();
    }

    async close() {
        await this.client.close();
    }

    async ping() {
        if (!this.db) throw new Error("Database has not been initialized.");
        await this.db.command({ ping: 1 }, { maxTimeMS: 3000 });
        return true;
    }

    async storeSanitizedImage(owner, purpose, sanitized) {
        const identity = actorIdentity(owner);
        if (!schemas.objectId(identity.userId) || !["quest", "completion", "message"].includes(purpose)) throw new Error("Invalid image owner or purpose.");
        const ownerId = new ObjectId(identity.userId);
        const imageId = new ObjectId();
        const now = new Date();
        const image = {
            _id: imageId, ownerId, ownerKerb: identity.kerb, purpose, requestId: null,
            format: sanitized.format, mimeType: sanitized.mimeType, width: sanitized.width,
            height: sanitized.height, size: sanitized.size, bytes: sanitized.buffer, createdAt: now,
        };
        return this.client.withSession(session => session.withTransaction(async () => {
            const userQuota = await this.users.updateOne({
                _id: ownerId,
                $expr: { $lte: [{ $add: [{ $ifNull: ["$imageStorageBytes", 0] }, sanitized.size] }, MAX_USER_IMAGE_STORAGE_BYTES] },
            }, { $inc: { imageStorageBytes: sanitized.size } }, { session });
            if (!userQuota.matchedCount) throw imageStorageLimitError("Your saved image storage is full. Remove old images or try a smaller file.");
            const globalQuota = await this.imageStorage.updateOne({ _id: "global-image-storage", bytes: { $lte: MAX_GLOBAL_IMAGE_STORAGE_BYTES - sanitized.size } }, { $inc: { bytes: sanitized.size } }, { session });
            if (!globalQuota.matchedCount) throw imageStorageLimitError("SideQuest image storage is temporarily full. Please try again later.");
            await this.images.insertOne(image, { session });
            return { id: String(imageId), url: `/api/images/${imageId}`, format: image.format, mimeType: image.mimeType, size: image.size, width: image.width, height: image.height };
        }));
    }

    async getOwnedImage(id, owner, purpose) {
        if (!schemas.objectId(id)) return null;
        const identity = actorIdentity(owner);
        return this.images.findOne({ _id: new ObjectId(id), ownerId: new ObjectId(identity.userId), purpose });
    }

    async getImageForViewer(id, viewer) {
        if (!schemas.objectId(id)) return null;
        const image = await this.images.findOne({ _id: new ObjectId(id) });
        if (!image) return null;
        const identity = actorIdentity(viewer);
        const isOwner = image.ownerId && schemas.objectId(identity.userId) && String(image.ownerId) === identity.userId;
        if (isOwner) return image;
        const moderatorKerbs = new Set([...(process.env.ADMIN_KERBS ?? "").split(","), ...(process.env.MODERATOR_KERBS ?? "").split(",")].map(value => value.trim()).filter(Boolean));
        if ((viewer?.roles ?? []).some(role => ["admin", "moderator"].includes(role)) || moderatorKerbs.has(identity.kerb)) {
            const openCase = await this.questModerationCases.findOne({ questId: image.requestId, status: "open", imageNeedsReview: true });
            if (openCase && image.purpose === "quest") return image;
        }
        if (!image.requestId) return null;
        const quest = await this.getQuestForViewer(String(image.requestId), viewer);
        if (!quest) return null;
        const referenceId = image.purpose === "quest" ? quest.imageId : quest.completionReceipt?.imageId;
        if (image.purpose === "message") {
            const linkedMessage = await this.messages.findOne({ requestId: quest._id, imageIds: image._id }, { projection: { _id: 1 } });
            return linkedMessage ? image : null;
        }
        return String(referenceId ?? "") === String(image._id) ? image : null;
    }

    async cleanupUnattachedImages(now = new Date()) {
        const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const oldImages = await this.images.find({ requestId: null, createdAt: { $lt: cutoff } }, { projection: { _id: 1, ownerId: 1, size: 1 } }).limit(100).toArray();
        let removed = 0;
        for (const image of oldImages) {
            const deleted = await this.client.withSession(session => session.withTransaction(async () => {
                const result = await this.images.deleteOne({ _id: image._id, requestId: null }, { session });
                if (!result.deletedCount) return false;
                await this.users.updateOne({ _id: image.ownerId }, { $inc: { imageStorageBytes: -image.size } }, { session });
                await this.imageStorage.updateOne({ _id: "global-image-storage" }, { $inc: { bytes: -image.size } }, { session });
                return true;
            }));
            if (deleted) removed += 1;
        }
        return removed;
    }

    async initializeIdentitySchema() {
        await this.users.updateMany({ identityProvider: { $exists: false } }, { $set: { identityProvider: "local", externalIdentityId: null, verifiedUniversityIdentityId: null, identityVerificationStatus: "unverified" } });
        const users = await this.users.find({ kerb: { $type: "string" } }, { projection: { _id: 1, kerb: 1 } }).toArray();
        const operations = new Map([
            [this.requests, []], [this.reviews, []], [this.disputes, []], [this.reports, []],
            [this.messages, []], [this.notifications, []], [this.feedback, []], [this.adminAudit, []],
        ]);
        const add = (collection, field, idField, userId, kerb) => operations.get(collection).push({
            updateMany: {
                filter: { [field]: kerb, $or: [{ [idField]: { $exists: false } }, { [idField]: null }] },
                update: { $set: { [idField]: userId } },
            },
        });
        for (const user of users) {
            if (!user.kerb) continue;
            add(this.requests, "requester", "requesterId", user._id, user.kerb);
            add(this.requests, "helper", "helperId", user._id, user.kerb);
            add(this.reviews, "reviewer", "reviewerId", user._id, user.kerb);
            add(this.reviews, "target", "targetId", user._id, user.kerb);
            add(this.disputes, "reporter", "reporterId", user._id, user.kerb);
            add(this.disputes, "requester", "requesterId", user._id, user.kerb);
            add(this.disputes, "completer", "completerId", user._id, user.kerb);
            add(this.reports, "reporter", "reporterId", user._id, user.kerb);
            add(this.reports, "subject", "subjectId", user._id, user.kerb);
            add(this.messages, "sender", "senderId", user._id, user.kerb);
            add(this.notifications, "kerb", "userId", user._id, user.kerb);
            add(this.feedback, "kerb", "userId", user._id, user.kerb);
            add(this.adminAudit, "admin", "adminId", user._id, user.kerb);
            add(this.adminAudit, "target", "targetId", user._id, user.kerb);
        }
        await Promise.all([...operations].filter(([, writes]) => writes.length).map(([collection, writes]) => collection.bulkWrite(writes, { ordered: false })));
    }

    async userIsSuspended(actor, now = new Date(), session) {
        const identity = actorIdentity(actor);
        const selector = schemas.objectId(identity.userId) ? { _id: new ObjectId(identity.userId) } : { kerb: identity.kerb };
        const user = await this.users.findOne(selector, { projection: { moderationStatus: 1, suspendedUntil: 1 }, session });
        return user?.moderationStatus === "permanently_suspended"
            || (user?.moderationStatus === "suspended" && (!user.suspendedUntil || user.suspendedUntil > now));
    }

    async isBlockedEitherWay(first, second, session) {
        const firstIdentity = actorIdentity(first);
        const secondIdentity = actorIdentity(second);
        const selector = identity => schemas.objectId(identity.userId) ? { _id: new ObjectId(identity.userId) } : { kerb: identity.kerb };
        const [firstUser, secondUser] = await Promise.all([
            this.users.findOne(selector(firstIdentity), { session, projection: { kerb: 1, blocked: 1, blockedUserIds: 1 } }),
            this.users.findOne(selector(secondIdentity), { session, projection: { kerb: 1, blocked: 1, blockedUserIds: 1 } }),
        ]);
        if (!firstUser || !secondUser) return false;
        return Boolean(
            (firstUser.blockedUserIds ?? []).some(id => String(id) === String(secondUser._id))
            || (secondUser.blockedUserIds ?? []).some(id => String(id) === String(firstUser._id))
            || (firstIdentity.kerb && (firstUser.blocked ?? []).includes(secondIdentity.kerb))
            || (secondIdentity.kerb && (secondUser.blocked ?? []).includes(firstIdentity.kerb))
        );
    }

    async getAllRequests(viewer) {
        const found = await this.requests.find({ deletedAt: null }).sort({ createdAt: -1 }).toArray();
        const visible = [];
        for (const request of found) {
            const status = normalizeQuestStatus(request.status);
            const party = viewer && (matchesIdentity(request, viewer, "requesterId", "requester") || matchesIdentity(request, viewer, "helperId", "helper"));
            if (!party && (request.moderationStatus ?? "approved") !== "approved") continue;
            if (status !== "open" && !party) continue;
            if (status === "open" && requestExpiry(request) <= Date.now()) continue;
            if (!party && viewer && request.requester && await this.isBlockedEitherWay(viewer, { userId: request.requesterId ? String(request.requesterId) : "", kerb: request.requester })) continue;
            visible.push(publicQuest(request, actorKerb(viewer), Boolean(party)));
        }
        return visible;
    }

    async postRequest(request) {
        const requesterId = schemas.objectId(request.requesterId ?? "") ? new ObjectId(request.requesterId) : null;
        const ownerFilter = requesterId ? { $or: [{ requesterId }, { requesterId: { $in: [null] }, requester: request.requester }] } : { requester: request.requester };
        const previous = await this.requests.findOne({ $and: [ownerFilter, { idempotencyKey: request.idempotencyKey }] });
        if (previous) return previous.payloadFingerprint === request.payloadFingerprint ? { ...previous, duplicate: true } : { conflict: true };
        const now = new Date();
        const rewardCents = request.rewardCents;
        try {
            return await this.client.withSession(session => session.withTransaction(async () => {
                const userSelector = requesterId ? { _id: requesterId } : { kerb: request.requester };
                const user = await this.users.findOneAndUpdate(userSelector, { $inc: { questActivityVersion: 1 } }, { session, returnDocument: "after" });
                if (!user || user.moderationStatus === "permanently_suspended" || (user.moderationStatus === "suspended" && (!user.suspendedUntil || user.suspendedUntil > now))) return null;
                const document = {
                    ...request,
                    requesterId: user._id,
                    ...(request.imageId ? { imageId: new ObjectId(request.imageId) } : {}),
                    pay: rewardCents / 100,
                    helper: null,
                    status: "open",
                    moderationStatus: request.moderationStatus ?? "approved",
                    moderationPolicyVersion: request.moderationPolicyVersion ?? null,
                    moderationCategories: request.moderationCategories ?? [],
                    moderationSignals: request.moderationSignals ?? [],
                    moderationMessage: request.moderationStatus === "pending_review" ? moderationMessage("pending_review") : null,
                    createdAt: now,
                    expiresAt: new Date(Date.parse(request.end)),
                    statusHistory: [{ from: null, to: "open", by: request.requester, at: now }],
                };
                const { insertedId } = await this.requests.insertOne(document, { session });
                if (document.moderationStatus === "pending_review") {
                    await this.questModerationCases.insertOne({ questId: insertedId, requesterId: user._id, requester: request.requester, status: "open", policyVersion: document.moderationPolicyVersion, categories: document.moderationCategories, signals: document.moderationSignals, imageNeedsReview: Boolean(request.imageId), createdAt: now, resolvedAt: null }, { session });
                }
                if (request.imageId) {
                    const attached = await this.images.updateOne({ _id: new ObjectId(request.imageId), ownerId: user._id, purpose: "quest", requestId: null }, { $set: { requestId: insertedId } }, { session });
                    if (!attached.modifiedCount) throw new Error("The quest image is no longer available.");
                }
                return { ...document, _id: insertedId };
            }));
        } catch (error) {
            if (error?.code !== 11000 || error?.keyPattern?.idempotencyKey == null) throw error;
            const duplicate = await this.requests.findOne({ $and: [ownerFilter, { idempotencyKey: request.idempotencyKey }] });
            if (!duplicate) throw error;
            return duplicate.payloadFingerprint === request.payloadFingerprint ? { ...duplicate, duplicate: true } : { conflict: true };
        }
    }

    async updateOpenRequest(id, requester, changes) {
        const quest = await this.requests.findOne({ $and: [{ _id: new ObjectId(id), deletedAt: null }, identityClause(requester, "requesterId", "requester")] });
        const now = Date.now();
        const status = normalizeQuestStatus(quest?.status);
        const wasExpired = status === "expired" || (status === "open" && requestExpiry(quest) <= now);
        const withinGrace = wasExpired && (quest.expirationGraceUntil ? new Date(quest.expirationGraceUntil).getTime() : expirationGraceDeadline(requestExpiry(quest))) > now;
        if (!quest || quest.moderationStatus === "pending_review" || !((status === "open" && !wasExpired) || (withinGrace && !quest.helper))) return null;
        const filter = { $and: [{ _id: quest._id, deletedAt: null, status: quest.status }, identityClause(requester, "requesterId", "requester")] };
        if (quest.end != null) filter.end = quest.end;
        else if (quest.expiresAt) filter.expiresAt = quest.expiresAt;
        else if (quest.createdAt) filter.createdAt = quest.createdAt;
        const set = { ...changes, ...(wasExpired ? { status: "open" } : {}) };
        const update = { $set: set };
        if (wasExpired) {
            update.$unset = { expiredAt: "", expirationGraceUntil: "", archivedAt: "" };
            update.$push = { statusHistory: { from: "expired", to: "open", by: actorKerb(requester), byId: schemas.objectId(actorIdentity(requester).userId) ? new ObjectId(actorIdentity(requester).userId) : null, reason: "requester_extended_deadline", at: new Date() } };
        }
        if (changes.moderationStatus === "approved") update.$set.moderationMessage = null;
        return this.client.withSession(session => session.withTransaction(async () => {
            const saved = await this.requests.findOneAndUpdate(filter, update, { returnDocument: "after", session });
            if (saved && changes.moderationStatus === "pending_review") {
                await this.questModerationCases.updateMany({ questId: quest._id, status: "open" }, { $set: { status: "superseded", resolvedAt: new Date() } }, { session });
                await this.questModerationCases.insertOne({ questId: quest._id, requesterId: quest.requesterId, requester: quest.requester, status: "open", policyVersion: changes.moderationPolicyVersion, categories: changes.moderationCategories ?? [], signals: changes.moderationSignals ?? [], imageNeedsReview: false, createdAt: new Date(), resolvedAt: null }, { session });
            } else if (saved && changes.moderationStatus === "approved") {
                await this.questModerationCases.updateMany({ questId: quest._id, status: "open" }, { $set: { status: "superseded", resolvedAt: new Date() } }, { session });
            }
            return saved;
        }));
    }

    async extendExpiredQuest(id, requester, end) {
        const quest = await this.requests.findOne({ $and: [{ _id: new ObjectId(id), deletedAt: null }, identityClause(requester, "requesterId", "requester")] });
        const questStatus = normalizeQuestStatus(quest?.status);
        const graceUntil = quest?.expirationGraceUntil ? new Date(quest.expirationGraceUntil).getTime() : expirationGraceDeadline(requestExpiry(quest ?? {}));
        const deadlineAlreadyPassed = quest && requestExpiry(quest) <= Date.now();
        if (!quest || !(["expired", "open"].includes(questStatus) && deadlineAlreadyPassed) || quest.helper || graceUntil <= Date.now() || Date.parse(end) <= Date.now()) return null;
        return this.updateOpenRequest(id, requester, { end, expiresAt: new Date(end) });
    }

    async connectRequest(id, helper) {
        const helperKerb = actorKerb(helper);
        const helperId = actorIdentity(helper).userId;
        const requestId = new ObjectId(id);
        const candidate = await this.requests.findOne({ _id: requestId, deletedAt: null });
            const now = new Date();
        if (!candidate || (candidate.moderationStatus ?? "approved") !== "approved" || (candidate.requester === helperKerb && (!candidate.requesterId || String(candidate.requesterId) === helperId)) || !canAccept(candidate.status, requestExpiry(candidate), now.getTime())) return null;
        const result = await this.client.withSession(session => session.withTransaction(async () => {
            const helperSelector = schemas.objectId(helperId) ? { _id: new ObjectId(helperId) } : { kerb: helperKerb };
            const helperUser = await this.users.findOneAndUpdate(helperSelector, { $inc: { questActivityVersion: 1 } }, { session, returnDocument: "after" });
            if (!helperUser || helperUser.moderationStatus === "permanently_suspended" || (helperUser.moderationStatus === "suspended" && (!helperUser.suspendedUntil || helperUser.suspendedUntil > new Date()))) return null;
            if (candidate.requesterId && String(candidate.requesterId) === String(helperUser._id)) return null;
            if (await this.isBlockedEitherWay({ userId: candidate.requesterId ? String(candidate.requesterId) : "", kerb: candidate.requester }, { userId: String(helperUser._id), kerb: helperKerb }, session)) return null;
            const acceptanceTime = new Date();
            const filter = { _id: requestId, helper: null, deletedAt: null, moderationStatus: { $in: ["approved", null] } };
            if (candidate.end != null) filter.end = { $gt: acceptanceTime.toISOString() };
            if (candidate.expiresAt) filter.expiresAt = { $gt: acceptanceTime };
            if (candidate.end == null && !candidate.expiresAt && candidate.createdAt) filter.createdAt = candidate.createdAt;
            else if (candidate.createdAt) filter.createdAt = candidate.createdAt;
            if (candidate.status == null) filter.status = { $in: [null, 0, "open"] };
            else filter.status = candidate.status;
            const snapshot = {
                title: candidate.title ?? candidate.description,
                description: candidate.description,
                category: candidate.category,
                rewardCents: Number.isSafeInteger(candidate.rewardCents) ? candidate.rewardCents : Math.round(Number(candidate.pay ?? 0) * 100),
                pickup: candidate.pickup ?? "",
                dropoff: candidate.dropoff ?? "",
                start: candidate.start ?? null,
                deadline: candidate.end ?? null,
                acceptedAt: acceptanceTime,
                paymentMethod: PAYMENT_METHODS.includes(candidate.paymentMethod)
                    ? candidate.paymentMethod
                    : PAYMENT_METHODS.includes(helperUser?.preferredPaymentMethod) ? helperUser.preferredPaymentMethod : null,
                paymentInstructions: sanitizeText(helperUser?.paymentInstructions, 160),
            };
            const updated = await this.requests.findOneAndUpdate(filter, {
                $set: { helper: helperKerb, helperId: helperUser._id, status: "in_progress", questStage: 0, acceptedAt: acceptanceTime, agreementSnapshot: snapshot },
                $push: { statusHistory: { from: "open", to: "in_progress", by: helperKerb, at: acceptanceTime } },
            }, { session, returnDocument: "after" });
            return updated;
        }));
        return result;
    }

    async reconcileQuestLifecycle(now = new Date()) {
        await this.requests.updateMany({ "helperLocation.updatedAt": { $lt: new Date(now.getTime() - 2 * 60 * 1000) } }, { $unset: { helperLocation: "" } });
        const candidates = await this.requests.find({ status: { $in: ["open", 0, null] }, helper: null, deletedAt: null }, {
            projection: { _id: 1, requester: 1, requesterId: 1, status: 1, end: 1, expiresAt: 1, createdAt: 1 },
        }).toArray();
        let newlyExpired = 0;
        for (const quest of candidates) {
            const deadline = requestExpiry(quest);
            if (!Number.isFinite(deadline) || deadline > now.getTime()) continue;
            const expiredAt = new Date(deadline);
            const filter = { _id: quest._id, status: quest.status ?? { $in: [null, 0] }, helper: null, deletedAt: null };
            if (quest.end != null) filter.end = quest.end;
            else if (quest.expiresAt) filter.expiresAt = quest.expiresAt;
            else if (quest.createdAt) filter.createdAt = quest.createdAt;
            const result = await this.requests.updateOne(filter, {
                $set: { status: "expired", expiredAt, expirationGraceUntil: new Date(expirationGraceDeadline(deadline)) },
                $push: { statusHistory: { from: "open", to: "expired", by: "system", reason: "deadline_passed", at: now } },
            });
            if (result.modifiedCount) newlyExpired += 1;
        }

        const expiredQuests = await this.requests.find({ status: "expired", helper: null, deletedAt: null }).toArray();
        for (const quest of expiredQuests) {
            const cancellationExpiry = quest.lastCancellation?.role === "acceptor";
            const cancellationAt = quest.lastCancellation?.at ? new Date(quest.lastCancellation.at).getTime() : null;
            await this.addNotificationOnce(quest.requesterId ? { userId: String(quest.requesterId), kerb: quest.requester } : quest.requester, {
                type: "expired", title: "Quest expired", message: cancellationExpiry
                    ? `The acceptor cancelled after the deadline. Your quest has expired: “${quest.title ?? quest.description}”.`
                    : `Your quest “${quest.title ?? quest.description}” has expired. Extend the deadline within 24 hours to make it available again.`, requestId: String(quest._id),
            }, cancellationExpiry && Number.isFinite(cancellationAt) ? `quest-cancel:${quest._id}:${cancellationAt}` : `quest-expired:${quest._id}`);
        }

        let archived = 0;
        for (const quest of expiredQuests) {
            const graceUntil = quest.expirationGraceUntil ? new Date(quest.expirationGraceUntil).getTime() : expirationGraceDeadline(requestExpiry(quest));
            if (!shouldArchiveExpiredQuest(quest.status, graceUntil, now.getTime(), {
                hasObligation: Boolean(quest.paymentSentAt || quest.paymentConfirmedAt || quest.requesterApprovedAt || quest.completionSubmission || quest.completionReceipt),
                hasDispute: Boolean(quest.disputeOpenedAt),
                completed: normalizeQuestStatus(quest.status) === "completed",
            })) continue;
            const filter = { _id: quest._id, status: "expired", helper: null, deletedAt: null, disputeOpenedAt: null };
            if (quest.expirationGraceUntil) filter.expirationGraceUntil = quest.expirationGraceUntil;
            if (quest.end != null) filter.end = quest.end;
            else if (quest.expiresAt) filter.expiresAt = quest.expiresAt;
            const result = await this.requests.updateOne(filter, { $set: { deletedAt: now, archivedAt: now, deletionReason: "expired_after_grace" } });
            if (result.modifiedCount) archived += 1;
        }
        return { newlyExpired, archived };
    }

    async updateQuestStage(id, helper, stage) {
        const quest = await this.requests.findOne({ $and: [{ _id: new ObjectId(id), deletedAt: null }, identityClause(helper, "helperId", "helper")] });
        if (!quest || normalizeQuestStatus(quest.status) !== "in_progress") return null;
        const nextStage = stage === "started" ? 1 : stage === "picked_up" ? 2 : null;
        if (nextStage == null || nextStage !== (quest.questStage ?? 0) + 1) return null;
        const now = new Date();
        const result = await this.requests.updateOne({ $and: [{ _id: quest._id, status: quest.status, questStage: quest.questStage ?? null }, identityClause(helper, "helperId", "helper")] }, {
            $set: { questStage: nextStage, lastProgressAt: now },
            $push: { progressHistory: { stage, by: actorKerb(helper), byId: schemas.objectId(actorIdentity(helper).userId) ? new ObjectId(actorIdentity(helper).userId) : null, at: now } },
        });
        return result.modifiedCount ? quest : null;
    }

    async updateQuestHelperLocation(id, helper, lat, lng) {
        const now = new Date();
        return this.requests.findOneAndUpdate({ $and: [
            { _id: new ObjectId(id), status: "in_progress", deletedAt: null },
            identityClause(helper, "helperId", "helper"),
        ] }, { $set: { helperLocation: { lat, lng, updatedAt: now } } }, { returnDocument: "after" });
    }

    async changeQuestState({ id, actor, from, to, fields = {} }) {
        if (!canTransition(from, to)) return null;
        const quest = await this.requests.findOne({ _id: new ObjectId(id), deletedAt: null });
        if (!quest || normalizeQuestStatus(quest.status) !== from) return null;
        const selector = { _id: quest._id, deletedAt: null };
        if (quest.status == null) selector.status = { $in: [null, 0] };
        else selector.status = quest.status;
        const now = new Date();
        const updated = await this.requests.findOneAndUpdate(selector, {
            $set: { ...fields, status: to },
            $push: { statusHistory: { from, to, by: actor, at: now } },
        }, { returnDocument: "after" });
        return updated;
    }

    async submitRequesterCompletion(id, requester, evidence, imageId) {
        const now = new Date();
        return this.client.withSession(session => session.withTransaction(async () => {
            const quest = await this.requests.findOne({ $and: [{ _id: new ObjectId(id), deletedAt: null }, identityClause(requester, "requesterId", "requester")] }, { session });
            if (!quest || normalizeQuestStatus(quest.status) !== "in_progress") return null;
            const identity = actorIdentity(requester);
            const receipt = { evidence, submittedAt: now, submittedById: quest.requesterId ?? null };
            if (imageId) {
                const image = await this.images.findOne({ _id: new ObjectId(imageId), ownerId: new ObjectId(identity.userId), purpose: "completion", requestId: null }, { session, projection: { _id: 1 } });
                if (!image) return null;
                receipt.imageId = image._id;
                const attached = await this.images.updateOne({ _id: image._id, requestId: null }, { $set: { requestId: quest._id } }, { session });
                if (!attached.modifiedCount) return null;
            }
            const updated = await this.requests.findOneAndUpdate(
                { $and: [{ _id: quest._id, status: quest.status, deletedAt: null }, identityClause(requester, "requesterId", "requester")] },
                { $set: { status: "awaiting_payment", completionReceipt: receipt, requesterApprovedAt: now, requesterApprovedById: quest.requesterId ?? null },
                    $unset: { helperLocation: "" },
                    $push: { statusHistory: { from: "in_progress", to: "awaiting_payment", by: actorKerb(requester), at: now } } },
                { returnDocument: "after", session }
            );
            if (!updated && imageId) await this.images.updateOne({ _id: new ObjectId(imageId), requestId: quest._id }, { $set: { requestId: null } }, { session });
            return updated;
        }));
    }

    async approveCompletion(id, requester) {
        const now = new Date();
        const quest = await this.requests.findOne({ $and: [{ _id: new ObjectId(id), deletedAt: null }, identityClause(requester, "requesterId", "requester")] });
        if (!quest || normalizeQuestStatus(quest.status) !== "pending_review") return null;
        return this.requests.findOneAndUpdate(
            { $and: [{ _id: quest._id, status: quest.status, deletedAt: null }, identityClause(requester, "requesterId", "requester")] },
            { $set: { status: "awaiting_payment", requesterApprovedAt: now, requesterApprovedById: quest.requesterId ?? null },
                $push: { statusHistory: { from: "pending_review", to: "awaiting_payment", by: actorKerb(requester), at: now } } },
            { returnDocument: "after" }
        );
    }

    async markPaymentSent(id, requester) {
        const now = new Date();
        const quest = await this.requests.findOne({ $and: [{ _id: new ObjectId(id), deletedAt: null }, identityClause(requester, "requesterId", "requester")] });
        if (!quest || normalizeQuestStatus(quest.status) !== "awaiting_payment") return null;
        return this.requests.findOneAndUpdate(
            { $and: [{ _id: quest._id, status: quest.status, deletedAt: null }, identityClause(requester, "requesterId", "requester")] },
            { $set: { status: "payment_sent", paymentSentAt: now, paymentClaimedBy: actorKerb(requester), paymentClaimedById: quest.requesterId ?? null },
                $push: { statusHistory: { from: "awaiting_payment", to: "payment_sent", by: actorKerb(requester), at: now } } },
            { returnDocument: "after" }
        );
    }

    async confirmPaymentReceived(id, helper) {
        const now = new Date();
        const quest = await this.requests.findOne({ $and: [{ _id: new ObjectId(id), deletedAt: null }, identityClause(helper, "helperId", "helper")] });
        if (!quest || normalizeQuestStatus(quest.status) !== "payment_sent") return null;
        return this.requests.findOneAndUpdate(
            { $and: [{ _id: quest._id, status: quest.status, deletedAt: null }, identityClause(helper, "helperId", "helper")] },
            { $set: { status: "completed", paymentConfirmedAt: now, completedAt: now, paymentConfirmedBy: actorKerb(helper), paymentConfirmedById: quest.helperId ?? null },
                $push: { statusHistory: { from: "payment_sent", to: "completed", by: actorKerb(helper), at: now } } },
            { returnDocument: "after" }
        );
    }

    async cancelQuest(id, actor, reason = "No reason provided") {
        const quest = await this.requests.findOne({ _id: new ObjectId(id), deletedAt: null });
        const isRequester = matchesIdentity(quest, actor, "requesterId", "requester");
        const isHelper = matchesIdentity(quest, actor, "helperId", "helper");
        if (!quest || (!isRequester && !isHelper)) return null;
        const status = normalizeQuestStatus(quest.status);
        if (!canTransition(status, "cancelled") && !(isHelper && status === "in_progress")) return null;
        const now = new Date();
        const identity = actorIdentity(actor);
        // Progress markers only indicate the helper started moving through the
        // workflow. If they cancel before the deadline, the requester should
        // be able to find another helper. Submitted completion evidence remains
        // a protected state and is not reopened automatically.
        const helperHasDoneWork = Boolean(quest.completionSubmission || quest.completionReceipt);
        const paymentObligationExists = Boolean(quest.paymentSentAt || quest.paymentConfirmedAt || quest.requesterApprovedAt || ["pending_review", "awaiting_payment", "payment_sent"].includes(status));
        const deadline = requestExpiry(quest);
        const disposition = cancellationStatus({ isAcceptor: isHelper, status, deadline, now: now.getTime(), hasWork: helperHasDoneWork, hasObligation: paymentObligationExists, hasDispute: Boolean(quest.disputeOpenedAt) });
        const reopenStatus = isHelper && status === "in_progress" && disposition !== "cancelled" ? disposition : null;
        const targetStatus = reopenStatus ?? "cancelled";
        const cancellation = {
            role: isHelper ? "acceptor" : "requester",
            reason: sanitizeText(reason, 500) || "No reason provided",
            at: now,
            previousAcceptor: quest.helper ?? null,
            previousAcceptorId: quest.helperId ?? null,
            cancelledBy: actorKerb(actor),
            cancelledById: schemas.objectId(identity.userId) ? new ObjectId(identity.userId) : null,
            autoReopened: reopenStatus === "open",
        };
        const filter = { _id: quest._id, status: quest.status, deletedAt: null, ...identityClause(actor, isHelper ? "helperId" : "requesterId", isHelper ? "helper" : "requester") };
        const update = {
            $set: { status: targetStatus, lastCancellation: cancellation, ...(targetStatus === "expired" ? { expiredAt: new Date(deadline), expirationGraceUntil: new Date(expirationGraceDeadline(deadline)) } : {}) },
            $push: { statusHistory: { from: status, to: targetStatus, by: actorKerb(actor), byId: cancellation.cancelledById, reason: cancellation.reason, previousAcceptor: cancellation.previousAcceptor, previousAcceptorId: cancellation.previousAcceptorId, at: now } },
        };
        if (reopenStatus) update.$unset = { helper: "", helperId: "", acceptedAt: "", agreementSnapshot: "", questStage: "", helperLocation: "" };
        else if (isHelper) update.$unset = { helperLocation: "" };
        return this.requests.findOneAndUpdate(filter, update, { returnDocument: "after" });
    }

    async openDispute(id, reporter, reason, description, evidence) {
        return this.client.withSession(session => session.withTransaction(async () => {
            const quest = await this.requests.findOne({ _id: new ObjectId(id), deletedAt: null }, { session });
            const status = quest ? normalizeQuestStatus(quest.status) : null;
            const isRequester = matchesIdentity(quest, reporter, "requesterId", "requester");
            const isHelper = matchesIdentity(quest, reporter, "helperId", "helper");
            if (!quest || (!isRequester && !isHelper) || !canTransition(status, "disputed")) return null;
            const now = new Date();
            const update = await this.requests.updateOne({ _id: quest._id, status: quest.status }, {
                $set: { status: "disputed", disputedFromStatus: status, disputeOpenedAt: now },
                $push: { statusHistory: { from: status, to: "disputed", by: actorKerb(reporter), at: now } },
            }, { session });
            if (!update.modifiedCount) return null;
            const reporterId = isRequester ? quest.requesterId : quest.helperId;
            const dispute = { questId: quest._id, requester: quest.requester, requesterId: quest.requesterId, completer: quest.helper, completerId: quest.helperId, reporter: actorKerb(reporter), reporterId, reason, description, evidence, status: "open", createdAt: now, resolvedAt: null, resolvedBy: null, adminDecision: "" };
            const { insertedId } = await this.disputes.insertOne(dispute, { session });
            return { ...dispute, _id: insertedId };
        }));
    }

    async resolveDispute(disputeId, admin, outcome, decision) {
        const adminKerb = actorKerb(admin);
        const adminId = schemas.objectId(actorIdentity(admin).userId) ? new ObjectId(actorIdentity(admin).userId) : null;
        return this.client.withSession(session => session.withTransaction(async () => {
            const dispute = await this.disputes.findOne({ _id: new ObjectId(disputeId), status: "open" }, { session });
            if (!dispute) return null;
            const quest = await this.requests.findOne({ _id: dispute.questId, status: "disputed" }, { session });
            if (!quest || !["restore", "cancel"].includes(outcome)) return null;
            const restoredStatus = outcome === "cancel" ? "cancelled" : quest.disputedFromStatus;
            if (!ACTIVE_TRANSACTION_STATES.includes(restoredStatus) && restoredStatus !== "cancelled") return null;
            const now = new Date();
            const change = await this.requests.updateOne({ _id: quest._id, status: "disputed" }, {
                $set: { status: restoredStatus, adminResolvedAt: now, adminResolvedBy: adminKerb, ...(adminId ? { adminResolvedById: adminId } : {}) },
                $unset: { disputedFromStatus: "" },
                $push: { statusHistory: { from: "disputed", to: restoredStatus, by: adminKerb, at: now } },
            }, { session });
            if (!change.modifiedCount) return null;
            await this.disputes.updateOne({ _id: dispute._id, status: "open" }, { $set: { status: "resolved", outcome, resolvedAt: now, resolvedBy: adminKerb, ...(adminId ? { resolvedById: adminId } : {}), adminDecision: decision } }, { session });
            await this.adminAudit.insertOne({ admin: adminKerb, ...(adminId ? { adminId } : {}), action: "resolve_dispute", target: disputeId, questId: quest._id, outcome, decision, createdAt: now }, { session });
            return { questId: quest._id, requester: quest.requester, helper: quest.helper, status: restoredStatus };
        }));
    }

    async submitReview(id, reviewer, rating, tags, text) {
        if (!schemas.objectId(id) || !Number.isInteger(rating) || rating < 1 || rating > 5) return null;
        const initialQuest = await this.requests.findOne({ _id: new ObjectId(id), deletedAt: null });
        if (!initialQuest || normalizeQuestStatus(initialQuest.status) !== "completed" || !initialQuest.paymentConfirmedAt) return null;
        const reviewerIsRequester = matchesIdentity(initialQuest, reviewer, "requesterId", "requester");
        const reviewerIsHelper = matchesIdentity(initialQuest, reviewer, "helperId", "helper");
        if (!reviewerIsRequester && !reviewerIsHelper) return null;
        const reviewerRole = reviewerIsRequester ? "requester" : "acceptor";
        const normalizedTags = normalizeTags(reviewerRole, tags);
        if (!normalizedTags || typeof text !== "string" || text.length > 500) return null;
        const cleanText = sanitizeText(text, 500);
        const reviewerKerb = reviewerIsRequester ? initialQuest.requester : initialQuest.helper;
        const reviewerId = reviewerIsRequester ? initialQuest.requesterId : initialQuest.helperId;
        const target = reviewerIsRequester ? initialQuest.helper : initialQuest.requester;
        const targetId = reviewerIsRequester ? initialQuest.helperId : initialQuest.requesterId;
        if (!target || (reviewerId && targetId && String(reviewerId) === String(targetId)) || reviewerKerb === target) return null;
        const now = new Date();
        const deadline = reviewWindowEnd(initialQuest);
        const review = {
            questId: initialQuest._id, reviewer: reviewerKerb, reviewerId: reviewerId ?? null,
            target, targetId: targetId ?? null, reviewerRole, reviewedUserRole: reviewerIsRequester ? "acceptor" : "requester",
            role: reviewerRole, rating, tags: normalizedTags, text: cleanText,
            createdAt: now, submittedAt: now, publicationStatus: "pending", moderationStatus: "visible",
            reviewWindowEndsAt: deadline == null ? null : new Date(deadline),
        };
        const result = await this.client.withSession(session => session.withTransaction(async () => {
            // Serialize the two submissions through the quest document so concurrent reviews
            // cannot both miss the other's pending review.
            const locked = await this.requests.findOneAndUpdate({ _id: initialQuest._id, status: "completed", paymentConfirmedAt: { $type: "date" }, deletedAt: null }, { $inc: { reviewSubmissionVersion: 1 } }, { session, returnDocument: "after" });
            const quest = locked?.value ?? locked;
            if (!quest) return null;
            const reviewerClause = reviewerId ? { $or: [{ reviewerId }, { reviewerId: null, reviewer: reviewerKerb }] } : { reviewer: reviewerKerb };
            const already = await this.reviews.findOne({ questId: quest._id, ...reviewerClause }, { session });
            if (already) return { duplicate: true };
            const otherReviewer = reviewerIsRequester ? quest.helperId : quest.requesterId;
            const otherKerb = reviewerIsRequester ? quest.helper : quest.requester;
            const otherQuery = otherReviewer ? { $or: [{ reviewerId: otherReviewer }, { reviewerId: null, reviewer: otherKerb }] } : { reviewer: otherKerb, reviewerId: null };
            const otherReview = await this.reviews.findOne({ questId: quest._id, ...otherQuery, publicationStatus: { $in: ["pending", "published", null] } }, { session });
            const publishNow = Boolean(otherReview || (deadline != null && now.getTime() >= deadline));
            if (publishNow) {
                review.publicationStatus = "published";
                review.publishedAt = now;
                if (otherReview) await this.reviews.updateOne({ _id: otherReview._id, publicationStatus: "pending" }, { $set: { publicationStatus: "published", publishedAt: now } }, { session });
            }
            const { insertedId } = await this.reviews.insertOne(review, { session });
            return { ...review, _id: insertedId, duplicate: false };
        }));
        if (result?.publicationStatus === "published") {
            const parties = [[initialQuest.requester, initialQuest.requesterId], [initialQuest.helper, initialQuest.helperId]];
            void Promise.all(parties.filter(([kerb]) => kerb).map(([kerb, userId]) => this.addNotificationOnce(userId ? { kerb, userId: String(userId) } : kerb, { type: "review_published", title: "Quest reviews are now public", message: `Reviews for “${initialQuest.title ?? initialQuest.description}” are now visible.`, requestId: String(initialQuest._id) }, `review-published:${initialQuest._id}:${String(userId ?? kerb)}`))).catch(error => console.error("Could not queue published review notifications:", error.name));
        }
        return result;
    }

    async hasReviewed(id, reviewer) {
        const identity = actorIdentity(reviewer);
        const reviewerQuery = schemas.objectId(identity.userId)
            ? { $or: [{ reviewerId: new ObjectId(identity.userId) }, { reviewerId: { $in: [null] }, reviewer: identity.kerb }] }
            : { reviewer: identity.kerb };
        return Boolean(await this.reviews.findOne({ $and: [{ questId: new ObjectId(id) }, reviewerQuery] }, { projection: { _id: 1 } }));
    }

    async reviewStatus(id, reviewer) {
        const identity = actorIdentity(reviewer);
        const quest = await this.requests.findOne({ _id: new ObjectId(id), deletedAt: null });
        const eligible = Boolean(quest && normalizeQuestStatus(quest.status) === "completed" && quest.paymentConfirmedAt && (matchesIdentity(quest, reviewer, "requesterId", "requester") || matchesIdentity(quest, reviewer, "helperId", "helper")));
        return { eligible, reviewed: eligible ? await this.hasReviewed(id, reviewer) : false, reviewWindowEndsAt: quest ? reviewWindowEnd(quest) : null };
    }

    async publishDueReviews(now = new Date()) {
        const due = await this.reviews.find({ publicationStatus: "pending", reviewWindowEndsAt: { $lte: now } }).toArray();
        let published = 0;
        for (const review of due) {
            const result = await this.reviews.updateOne({ _id: review._id, publicationStatus: "pending" }, { $set: { publicationStatus: "published", publishedAt: now } });
            published += result.modifiedCount;
            if (result.modifiedCount) {
                const quest = await this.requests.findOne({ _id: review.questId }, { projection: { title: 1, description: 1, requester: 1, requesterId: 1, helper: 1, helperId: 1 } });
                if (quest) for (const [kerb, userId] of [[quest.requester, quest.requesterId], [quest.helper, quest.helperId]]) {
                    if (kerb) await this.addNotificationOnce(userId ? { kerb, userId: String(userId) } : kerb, { type: "review_published", title: "A quest review is now public", message: `A review for “${quest.title ?? quest.description}” is now visible.`, requestId: String(quest._id) }, `review-published:${review.questId}:${String(userId ?? kerb)}`);
                }
            }
        }
        return published;
    }

    async dueReviewReminders(now = new Date()) {
        const reminderWindowEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        const completionWindowStart = new Date(now.getTime() - REVIEW_WINDOW_MS);
        const completionWindowEnd = new Date(completionWindowStart.getTime() + 24 * 60 * 60 * 1000);
        const quests = await this.requests.find({ status: "completed", deletedAt: null, $or: [
            { completedAt: { $gte: completionWindowStart, $lte: completionWindowEnd } },
            { completedAt: { $in: [null] }, paymentConfirmedAt: { $gte: completionWindowStart, $lte: completionWindowEnd } },
        ] }).toArray();
        let sent = 0;
        for (const quest of quests) {
            const deadline = reviewWindowEnd(quest);
            if (deadline == null || deadline < now.getTime() || deadline > reminderWindowEnd.getTime()) continue;
            for (const [kerb, userId] of [[quest.requester, quest.requesterId], [quest.helper, quest.helperId]]) {
                if (!kerb || await this.hasReviewed(String(quest._id), userId ? { userId: String(userId), kerb } : kerb)) continue;
                const result = await this.addNotificationOnce(userId ? { userId: String(userId), kerb } : kerb, { type: "review_reminder", title: "Share your quest experience", message: `Your review window for “${quest.title ?? quest.description}” closes within 24 hours.`, requestId: String(quest._id) }, `review-reminder:${quest._id}:${String(userId ?? kerb)}`);
                if (result) sent += 1;
            }
        }
        return sent;
    }

    async publicReviews(actor) {
        const identity = actorIdentity(actor);
        const hasId = schemas.objectId(identity.userId);
        const reviews = await this.reviews.find({ $and: [{ publicationStatus: { $in: ["published", null] } }, { moderationStatus: { $nin: ["hidden", "removed"] } }, { $or: [...(hasId ? [{ targetId: new ObjectId(identity.userId) }] : []), ...(identity.kerb ? [{ target: identity.kerb }] : [])] }] }).sort({ createdAt: -1 }).limit(50).toArray();
        return reviews.map(({ _id, questId, role, reviewerRole, reviewedUserRole, rating, ratings, tags, text, createdAt }) => ({ id: String(_id), questId: String(questId), role: reviewerRole ?? role, reviewedUserRole: reviewedUserRole ?? (role === "completer" ? "acceptor" : "requester"), rating: reviewStarValue({ rating, ratings }), tags: tags ?? [], text, createdAt }));
    }

    async createUserReport(reporter, subject, reason, description, evidence) {
        const reporterIdentity = actorIdentity(reporter);
        const subjectUser = await this.users.findOne({ kerb: subject }, { projection: { _id: 1 } });
        if (reporterIdentity.kerb === subject || (reporterIdentity.userId && subjectUser && String(subjectUser._id) === reporterIdentity.userId) || !subjectUser) return null;
        const report = { reporter: reporterIdentity.kerb, reporterId: schemas.objectId(reporterIdentity.userId) ? new ObjectId(reporterIdentity.userId) : null, subject, subjectId: subjectUser._id, reason, description, evidence, status: "open", createdAt: new Date(), resolvedAt: null, resolvedBy: null };
        const { insertedId } = await this.reports.insertOne(report);
        return { ...report, _id: insertedId };
    }

    async moderateUser(target, admin, action, note) {
        const adminKerb = actorKerb(admin);
        const adminId = schemas.objectId(actorIdentity(admin).userId) ? new ObjectId(actorIdentity(admin).userId) : null;
        const targetUser = await this.users.findOne({ kerb: target });
        if (!targetUser) return null;
        const now = new Date();
        const strikesForSuspension = Math.max(0, Number.parseInt(process.env.MODERATION_STRIKES_FOR_SUSPENSION ?? "3", 10) || 0);
        const suspensionHours = Math.max(1, Number.parseInt(process.env.MODERATION_SUSPENSION_HOURS ?? "72", 10) || 72);
        let set = { lastModerationAt: now };
        let increment = {};
        if (action === "warning") set.moderationWarningAt = now;
        else if (action === "strike") {
            increment.strikes = 1;
            if (strikesForSuspension > 0 && (targetUser.strikes ?? 0) + 1 >= strikesForSuspension) {
                set.moderationStatus = "suspended";
                set.suspendedUntil = new Date(now.getTime() + suspensionHours * 3600000);
            }
        } else if (action === "suspend") {
            set.moderationStatus = "suspended";
            set.suspendedUntil = new Date(now.getTime() + suspensionHours * 3600000);
        } else if (action === "permanent_suspend") set.moderationStatus = "permanently_suspended";
        else if (action === "reinstate") {
            set.moderationStatus = "active";
            set.suspendedUntil = null;
        } else return null;
        const update = { $set: set };
        if (Object.keys(increment).length) update.$inc = increment;
        await this.users.updateOne({ kerb: target }, update);
        await this.adminAudit.insertOne({ admin: adminKerb, ...(adminId ? { adminId } : {}), target, targetId: targetUser._id, action, note, createdAt: now });
        return { kerb: target, action, moderationStatus: set.moderationStatus ?? targetUser.moderationStatus ?? "active", strikes: (targetUser.strikes ?? 0) + (increment.strikes ?? 0), suspendedUntil: set.suspendedUntil ?? targetUser.suspendedUntil ?? null };
    }

    async moderateUserFromReport(reportId, admin, target, action, note, decision) {
        const adminKerb = actorKerb(admin);
        const adminId = schemas.objectId(actorIdentity(admin).userId) ? new ObjectId(actorIdentity(admin).userId) : null;
        return this.client.withSession(session => session.withTransaction(async () => {
            const report = await this.reports.findOne({ _id: new ObjectId(reportId), subject: target, status: "open" }, { session });
            if (!report) return null;
            const targetUser = await this.users.findOne({ kerb: target }, { session });
            if (!targetUser) return null;
            const now = new Date();
            const strikesForSuspension = Math.max(0, Number.parseInt(process.env.MODERATION_STRIKES_FOR_SUSPENSION ?? "3", 10) || 0);
            const suspensionHours = Math.max(1, Number.parseInt(process.env.MODERATION_SUSPENSION_HOURS ?? "72", 10) || 72);
            const set = { lastModerationAt: now };
            const update = { $set: set };
            if (action === "warning") set.moderationWarningAt = now;
            else if (action === "strike") {
                update.$inc = { strikes: 1 };
                if (strikesForSuspension && (targetUser.strikes ?? 0) + 1 >= strikesForSuspension) { set.moderationStatus = "suspended"; set.suspendedUntil = new Date(now.getTime() + suspensionHours * 3600000); }
            } else if (action === "suspend") { set.moderationStatus = "suspended"; set.suspendedUntil = new Date(now.getTime() + suspensionHours * 3600000); }
            else if (action === "permanent_suspend") set.moderationStatus = "permanently_suspended";
            else if (action === "reinstate") { set.moderationStatus = "active"; set.suspendedUntil = null; }
            else return null;
            const changed = await this.users.updateOne({ kerb: target }, update, { session });
            if (!changed.modifiedCount) return null;
            await this.reports.updateOne({ _id: report._id, status: "open" }, { $set: { status: "reviewed", decision, resolvedBy: adminKerb, ...(adminId ? { resolvedById: adminId } : {}), resolvedAt: now, moderationAction: action } }, { session });
            await this.adminAudit.insertOne({ admin: adminKerb, ...(adminId ? { adminId } : {}), action, target, targetId: targetUser._id, reportId: report._id, note, createdAt: now }, { session });
            return { kerb: target, action, moderationStatus: set.moderationStatus ?? targetUser.moderationStatus ?? "active", strikes: (targetUser.strikes ?? 0) + (update.$inc?.strikes ?? 0), suspendedUntil: set.suspendedUntil ?? targetUser.suspendedUntil ?? null };
        }));
    }

    async adminQueue() {
        const [disputes, reports, reviewReports, questModerationCases] = await Promise.all([
            this.disputes.find({ status: "open" }).sort({ createdAt: 1 }).limit(100).toArray(),
            this.reports.find({ status: "open" }).sort({ createdAt: 1 }).limit(100).toArray(),
            this.reviewReports.find({ status: "open" }).sort({ createdAt: 1 }).limit(100).toArray(),
            this.questModerationCases.find({ status: "open" }).sort({ createdAt: 1 }).limit(100).toArray(),
        ]);
        const enrichedReviewReports = await Promise.all(reviewReports.map(async report => ({ ...report, review: await this.reviews.findOne({ _id: report.reviewId }) })));
        const enrichedQuestCases = await Promise.all(questModerationCases.map(async item => {
            const quest = await this.requests.findOne({ _id: item.questId, deletedAt: null });
            const requester = await this.users.findOne({ _id: item.requesterId }, { projection: { name: 1 } });
            return { ...item, quest: quest ? { _id: String(quest._id), title: quest.title, description: quest.description, category: quest.category, pay: quest.pay, pickup: quest.pickup, dropoff: quest.dropoff, imageUrl: quest.imageId ? `/api/images/${quest.imageId}` : null } : null, requesterName: requester?.name ?? item.requester };
        }));
        return { disputes, reports, reviewReports: enrichedReviewReports, questModeration: enrichedQuestCases };
    }

    async resolveQuestModeration(caseId, moderator, action, decision) {
        const identity = actorIdentity(moderator);
        const moderatorId = schemas.objectId(identity.userId) ? new ObjectId(identity.userId) : null;
        return this.client.withSession(session => session.withTransaction(async () => {
            const item = await this.questModerationCases.findOne({ _id: new ObjectId(caseId), status: "open" }, { session });
            if (!item || !["approve", "reject"].includes(action)) return null;
            const now = new Date();
            const moderationStatus = action === "approve" ? "approved" : "rejected";
            const updated = await this.requests.updateOne({ _id: item.questId, moderationStatus: "pending_review", deletedAt: null }, { $set: { moderationStatus, moderationMessage: action === "approve" ? null : `${moderationMessage("rejected")} Moderator note: ${decision}`, moderatedAt: now, moderatedBy: identity.kerb, moderationDecision: decision } }, { session });
            if (!updated.modifiedCount) return null;
            await this.questModerationCases.updateOne({ _id: item._id, status: "open" }, { $set: { status: "reviewed", action, decision, resolvedAt: now, resolvedBy: identity.kerb, ...(moderatorId ? { resolvedById: moderatorId } : {}) } }, { session });
            await this.adminAudit.insertOne({ admin: identity.kerb, ...(moderatorId ? { adminId: moderatorId } : {}), action: `quest_${action}`, targetId: item.questId, moderationCaseId: item._id, policyVersion: item.policyVersion, categories: item.categories, note: decision, createdAt: now }, { session });
            return { requester: item.requester, requesterId: item.requesterId ? String(item.requesterId) : "", questId: String(item.questId), moderationStatus };
        }));
    }

    async createReviewReport(reporter, reviewId, reason, description) {
        const identity = actorIdentity(reporter);
        const review = await this.reviews.findOne({ _id: new ObjectId(reviewId), publicationStatus: { $in: ["published", null] }, moderationStatus: { $nin: ["hidden", "removed"] } });
        if (!review || matchesIdentity(review, reporter, "reviewerId", "reviewer")) return null;
        const report = { reviewId: review._id, questId: review.questId, reporter: identity.kerb, reporterId: schemas.objectId(identity.userId) ? new ObjectId(identity.userId) : null, reason, description, status: "open", createdAt: new Date(), resolvedAt: null };
        const { insertedId } = await this.reviewReports.insertOne(report);
        return { ...report, _id: insertedId };
    }

    async resolveReviewReport(reportId, admin, action, decision) {
        const adminKerb = actorKerb(admin);
        const identity = actorIdentity(admin);
        const adminId = schemas.objectId(identity.userId) ? new ObjectId(identity.userId) : null;
        return this.client.withSession(session => session.withTransaction(async () => {
            const report = await this.reviewReports.findOne({ _id: new ObjectId(reportId), status: "open" }, { session });
            if (!report || !["hide", "keep"].includes(action)) return null;
            const now = new Date();
            if (action === "hide") await this.reviews.updateOne({ _id: report.reviewId }, { $set: { moderationStatus: "hidden", moderatedAt: now, moderatedBy: adminKerb } }, { session });
            await this.reviewReports.updateOne({ _id: report._id, status: "open" }, { $set: { status: "reviewed", decision, action, resolvedAt: now, resolvedBy: adminKerb, ...(adminId ? { resolvedById: adminId } : {}) } }, { session });
            await this.adminAudit.insertOne({ admin: adminKerb, ...(adminId ? { adminId } : {}), action: `review_report_${action}`, reportId: report._id, reviewId: report.reviewId, decision, createdAt: now }, { session });
            return { reviewId: String(report.reviewId), action };
        }));
    }

    async hasReviewReported(reviewId, reporter) {
        const identity = actorIdentity(reporter);
        const query = schemas.objectId(identity.userId) ? { reporterId: new ObjectId(identity.userId) } : { reporter: identity.kerb };
        return Boolean(await this.reviewReports.findOne({ reviewId: new ObjectId(reviewId), ...query }, { projection: { _id: 1 } }));
    }

    async resolveUserReport(reportId, admin, decision) {
        const adminKerb = actorKerb(admin);
        const adminId = schemas.objectId(actorIdentity(admin).userId) ? new ObjectId(actorIdentity(admin).userId) : null;
        const now = new Date();
        const result = await this.reports.findOneAndUpdate({ _id: new ObjectId(reportId), status: "open" }, { $set: { status: "reviewed", decision, resolvedBy: adminKerb, ...(adminId ? { resolvedById: adminId } : {}), resolvedAt: now } }, { returnDocument: "after" });
        if (!result) return null;
        await this.adminAudit.insertOne({ admin: adminKerb, ...(adminId ? { adminId } : {}), action: "resolve_user_report", target: reportId, decision, createdAt: now });
        return result;
    }

    async updatePaymentPreference(actor, method, instructions) {
        const identity = actorIdentity(actor);
        const selector = schemas.objectId(identity.userId) ? { _id: new ObjectId(identity.userId) } : { kerb: identity.kerb };
        const update = await this.users.updateOne(selector, { $set: { preferredPaymentMethod: method, paymentInstructions: instructions, paymentPreferenceUpdatedAt: new Date() } });
        return update.matchedCount === 1;
    }

    async signup(kerb, name, password) {
        await this.users.insertOne({ kerb, name, bio: "", password, createdAt: new Date(), identityProvider: "local", externalIdentityId: null, verifiedUniversityIdentityId: null, identityVerificationStatus: "unverified", roles: [], strikes: 0, moderationStatus: "active", blocked: [], blockedUserIds: [], pfp: null });
    }

    async findUser(kerb) { return this.users.findOne({ kerb }); }
    async findUserById(id) {
        if (typeof id !== "string" || !schemas.objectId(id)) return null;
        return this.users.findOne({ _id: new ObjectId(id) });
    }

    async findUserPublic(kerb) {
        const user = await this.findUser(kerb);
        if (!user) return null;
        delete user.password;
        delete user.blocked;
        delete user.paymentInstructions;
        return user;
    }

    async toggleBlock(actor, dest) {
        const identity = actorIdentity(actor);
        const selfSelector = schemas.objectId(identity.userId) ? { _id: new ObjectId(identity.userId) } : { kerb: identity.kerb };
        const [user, target] = await Promise.all([
            this.users.findOne(selfSelector, { projection: { kerb: 1, blocked: 1, blockedUserIds: 1 } }),
            this.users.findOne({ kerb: dest }, { projection: { _id: 1, kerb: 1 } }),
        ]);
        if (!user || !target || user._id.equals(target._id)) return null;
        const isBlocked = (user.blockedUserIds ?? []).some(id => String(id) === String(target._id)) || (user.blocked ?? []).includes(dest);
        await this.users.updateOne({ _id: user._id }, isBlocked
            ? { $pull: { blocked: dest, blockedUserIds: target._id } }
            : { $addToSet: { blocked: dest, blockedUserIds: target._id } });
        return !isBlocked;
    }

    async getPostedRequests(actor) {
        const quests = await this.requests.find({ $and: [identityClause(actor, "requesterId", "requester"), { deletedAt: null }] }).sort({ createdAt: -1 }).toArray();
        return quests.map(quest => publicQuest(quest, actorKerb(actor), true));
    }

    async getMyQuests(actor) {
        const quests = await this.requests.find({ $or: [identityClause(actor, "requesterId", "requester"), identityClause(actor, "helperId", "helper")], deletedAt: null }).sort({ createdAt: -1 }).toArray();
        return Promise.all(quests.map(async quest => ({ ...publicQuest(quest, actorKerb(actor), true), reviewSubmitted: normalizeQuestStatus(quest.status) === "completed" ? await this.hasReviewed(String(quest._id), actor) : false })));
    }

    async getRequestById(id) { return this.requests.findOne({ _id: new ObjectId(id), deletedAt: null }); }

    async getQuestForViewer(id, viewer) {
        const quest = await this.getRequestById(id);
        if (!quest) return null;
        const party = matchesIdentity(quest, viewer, "requesterId", "requester") || matchesIdentity(quest, viewer, "helperId", "helper");
        if (!party && (quest.moderationStatus ?? "approved") !== "approved") return null;
        const viewerKerb = actorKerb(viewer);
        const openAndAvailable = normalizeQuestStatus(quest.status) === "open" && requestExpiry(quest) > Date.now();
        if (!party && !openAndAvailable) return null;
        if (!party && quest.requester && await this.isBlockedEitherWay(viewer, { userId: quest.requesterId ? String(quest.requesterId) : "", kerb: quest.requester })) return null;
        return publicQuest(quest, viewerKerb, party);
    }

    async deleteRequest(id, actor) {
        const quest = await this.requests.findOne({ $and: [{ _id: new ObjectId(id), deletedAt: null }, identityClause(actor, "requesterId", "requester")] });
        const status = normalizeQuestStatus(quest?.status);
        const graceUntil = quest?.expirationGraceUntil ? new Date(quest.expirationGraceUntil).getTime() : expirationGraceDeadline(requestExpiry(quest ?? {}));
        const openAvailable = status === "open" && requestExpiry(quest ?? {}) > Date.now();
        const expiredInGrace = (status === "expired" || (status === "open" && requestExpiry(quest ?? {}) <= Date.now())) && graceUntil > Date.now() && !quest?.helper;
        if (!quest || !(openAvailable || expiredInGrace)) return { modifiedCount: 0 };
        return this.requests.updateOne({ $and: [{ _id: quest._id, status: quest.status, deletedAt: null }, identityClause(actor, "requesterId", "requester")] }, { $set: { deletedAt: new Date(), archivedAt: new Date(), deletionReason: "requester_deleted" } });
    }

    async getQuestMessages(requestId, since = null) {
        const filter = { requestId: new ObjectId(requestId) };
        if (since && Number.isFinite(Date.parse(since))) filter.createdAt = { $gt: new Date(since) };
        return this.messages.find(filter).sort({ createdAt: 1 }).limit(100).toArray();
    }

    async addQuestMessage(requestId, sender, text, imageIds = []) {
        const identity = actorIdentity(sender);
        if (!schemas.objectId(requestId) || !schemas.objectId(identity.userId) || !Array.isArray(imageIds) || imageIds.length > 3
            || imageIds.some(id => !schemas.objectId(id)) || new Set(imageIds).size !== imageIds.length) throw new Error("Invalid message attachment.");
        const requestObjectId = new ObjectId(requestId);
        const ownerId = new ObjectId(identity.userId);
        const imageObjectIds = imageIds.map(id => new ObjectId(id));
        const message = { requestId: requestObjectId, sender: identity.kerb, senderId: ownerId, text, imageIds: imageObjectIds, createdAt: new Date() };
        return this.client.withSession(session => session.withTransaction(async () => {
            if (imageObjectIds.length) {
                const ownedImages = await this.images.find({ _id: { $in: imageObjectIds }, ownerId, purpose: "message", requestId: null }, { session, projection: { _id: 1 } }).toArray();
                if (ownedImages.length !== imageObjectIds.length) throw new Error("One or more message photos are no longer available. Please attach them again.");
                const attached = await this.images.updateMany({ _id: { $in: imageObjectIds }, ownerId, purpose: "message", requestId: null }, { $set: { requestId: requestObjectId } }, { session });
                if (attached.modifiedCount !== imageObjectIds.length) throw new Error("One or more message photos could not be attached. Please try again.");
            }
            const { insertedId } = await this.messages.insertOne(message, { session });
            return { ...message, _id: insertedId };
        }));
    }

    async addNotification(recipient, notification) {
        const identity = actorIdentity(recipient);
        if (!identity.userId && !identity.kerb) return;
        const user = !identity.userId && identity.kerb ? await this.users.findOne({ kerb: identity.kerb }, { projection: { _id: 1 } }) : null;
        const userId = identity.userId || (user?._id ? String(user._id) : "");
        if (!schemas.objectId(userId) && !identity.kerb) return;
        await this.notifications.insertOne({ kerb: identity.kerb || undefined, userId: schemas.objectId(userId) ? new ObjectId(userId) : null, ...notification, readAt: null, createdAt: new Date() });
    }

    async addNotificationOnce(recipient, notification, dedupeKey) {
        const identity = actorIdentity(recipient);
        if (!identity.userId && !identity.kerb) return;
        const user = !identity.userId && identity.kerb ? await this.users.findOne({ kerb: identity.kerb }, { projection: { _id: 1 } }) : null;
        const userId = identity.userId || (user?._id ? String(user._id) : "");
        if (!schemas.objectId(userId) && !identity.kerb) return;
        try {
            const result = await this.notifications.updateOne({ dedupeKey }, { $setOnInsert: {
            dedupeKey,
            kerb: identity.kerb || undefined,
            userId: schemas.objectId(userId) ? new ObjectId(userId) : null,
            ...notification,
            readAt: null,
            createdAt: new Date(),
            } }, { upsert: true });
            return result.upsertedCount === 1;
        }
        catch (error) { if (error?.code !== 11000) throw error; }
    }

    async getNotifications(actor) {
        const identity = actorIdentity(actor);
        const query = schemas.objectId(identity.userId)
            ? { $or: [{ userId: new ObjectId(identity.userId) }, { userId: { $in: [null] }, kerb: identity.kerb }] }
            : { kerb: identity.kerb };
        return this.notifications.find(query).sort({ createdAt: -1 }).limit(50).toArray();
    }
    async markNotificationRead(id, actor) {
        const identity = actorIdentity(actor);
        const recipient = schemas.objectId(identity.userId)
            ? { $or: [{ userId: new ObjectId(identity.userId) }, { userId: { $in: [null] }, kerb: identity.kerb }] }
            : { kerb: identity.kerb };
        return this.notifications.updateOne({ $and: [{ _id: new ObjectId(id) }, recipient] }, { $set: { readAt: new Date() } });
    }

    async submitFeedback(actor, kind, message) {
        const identity = actorIdentity(actor);
        const feedback = { kerb: identity.kerb, userId: schemas.objectId(identity.userId) ? new ObjectId(identity.userId) : null, kind, message, createdAt: new Date() };
        const { insertedId } = await this.feedback.insertOne(feedback);
        return { ...feedback, _id: insertedId };
    }

    async getUserMetrics(actor, includePrivate = false) {
        const identity = actorIdentity(actor);
        const kerb = identity.kerb;
        const hasId = schemas.objectId(identity.userId);
        const userSelector = hasId ? { _id: new ObjectId(identity.userId) } : { kerb };
        const [user, quests, reviews] = await Promise.all([
            this.users.findOne(userSelector, { projection: { password: 0, blocked: 0, blockedUserIds: 0, paymentInstructions: 0, hasReviewed: 0, hasGottenReviewed: 0 } }),
            this.requests.find({ $or: [...(hasId ? [{ requesterId: new ObjectId(identity.userId) }, { helperId: new ObjectId(identity.userId) }] : []), ...(kerb ? [{ requester: kerb }, { helper: kerb }] : [])] }, { projection: { requester: 1, helper: 1, requesterId: 1, helperId: 1, status: 1, rewardCents: 1, pay: 1, paymentSentAt: 1, paymentConfirmedAt: 1, completedAt: 1, deletedAt: 1 } }).toArray(),
            this.reviews.find({ $and: [{ publicationStatus: { $in: ["published", null] } }, { moderationStatus: { $nin: ["hidden", "removed"] } }, { $or: [...(hasId ? [{ targetId: new ObjectId(identity.userId) }] : []), ...(kerb ? [{ target: kerb }] : [])] }] }, { projection: { rating: 1, ratings: 1, tags: 1, text: 1, role: 1, reviewerRole: 1, reviewedUserRole: 1, createdAt: 1, questId: 1 } }).sort({ createdAt: -1 }).toArray(),
        ]);
        if (!user) return null;
        const owns = (quest, role) => hasId && quest[`${role}Id`] ? String(quest[`${role}Id`]) === identity.userId : Boolean(kerb && quest[role] === kerb);
        const confirmed = quests.filter(quest => owns(quest, "helper") && normalizeQuestStatus(quest.status) === "completed" && quest.paymentConfirmedAt);
        const completedQuests = quests.filter(quest => normalizeQuestStatus(quest.status) === "completed" && quest.paymentConfirmedAt && (owns(quest, "requester") || owns(quest, "helper")));
        const paymentSent = quests.filter(quest => owns(quest, "requester") && quest.paymentSentAt);
        const totalRewardCents = confirmed.reduce((sum, quest) => sum + (Number.isSafeInteger(quest.rewardCents) ? quest.rewardCents : Math.round(Number(quest.pay ?? 0) * 100)), 0);
        const summary = ratingSummary(reviews);
        const roleSummary = role => ratingSummary(reviews.filter(review => (review.reviewedUserRole ?? (review.role === "completer" ? "acceptor" : "requester")) === role));
        const tagCounts = {};
        for (const review of reviews.filter(isPublishedReview)) for (const tag of review.tags ?? []) tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
        const roleRatings = { asRequester: roleSummary("requester"), asAcceptor: roleSummary("acceptor") };
        const recentReviews = reviews.filter(isPublishedReview).map(review => ({ ...review, role: review.reviewerRole ?? review.role, reviewedUserRole: review.reviewedUserRole ?? (review.role === "completer" ? "acceptor" : "requester"), rating: reviewStarValue(review), tags: review.tags ?? [] }));
        return {
            userId: String(user._id), kerb: user.kerb, name: user.name, createdAt: user.createdAt ?? null,
            identityVerificationStatus: user.identityProvider === "mit-touchstone" && user.externalIdentityId && user.verifiedUniversityIdentityId && user.identityVerificationStatus === "verified" ? "verified" : "unverified",
            ...(includePrivate ? {
                moderationStatus: user.moderationStatus ?? "active",
                preferredPaymentMethod: PAYMENT_METHODS.includes(user.preferredPaymentMethod) ? user.preferredPaymentMethod : "Cash",
                paymentInstructions: user.paymentInstructions ?? "",
            } : {}),
            postedQuests: quests.filter(quest => owns(quest, "requester") && !quest.deletedAt).length,
            completedQuests: completedQuests.length,
            confirmedPayments: paymentSent.filter(quest => normalizeQuestStatus(quest.status) === "completed" && quest.paymentConfirmedAt).length,
            paymentConfirmationRate: paymentSent.length ? Math.round(paymentSent.filter(quest => normalizeQuestStatus(quest.status) === "completed" && quest.paymentConfirmedAt).length * 100 / paymentSent.length) : null,
            totalConfirmedEarningsCents: totalRewardCents,
            ...summary,
            ratingAsRequester: roleRatings.asRequester.rating, reviewsAsRequester: roleRatings.asRequester.reviewCount,
            ratingAsAcceptor: roleRatings.asAcceptor.rating, reviewsAsAcceptor: roleRatings.asAcceptor.reviewCount,
            frequentTags: Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([tag, count]) => ({ tag, count })),
            reviews: recentReviews,
        };
    }

    async searchUsers(query, viewer) {
        const viewerIdentity = actorIdentity(viewer);
        const pattern = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const [viewerUser, users] = await Promise.all([
            viewer ? this.users.findOne(schemas.objectId(viewerIdentity.userId) ? { _id: new ObjectId(viewerIdentity.userId) } : { kerb: viewerIdentity.kerb }, { projection: { blocked: 1, blockedUserIds: 1 } }) : null,
            this.users.find({ $or: [{ name: { $regex: pattern, $options: "i" } }, { kerb: { $regex: pattern, $options: "i" } }] }, { projection: { kerb: 1 } }).limit(12).toArray(),
        ]);
        const blocked = new Set(viewerUser?.blocked ?? []);
        const eligible = [];
        for (const user of users) {
            const isSelf = String(viewerUser?._id ?? "") === String(user._id);
            if (isSelf || blocked.has(user.kerb) || (viewer && await this.isBlockedEitherWay(viewer, { userId: String(user._id), kerb: user.kerb }))) continue;
            eligible.push(user);
        }
        return Promise.all(eligible.map(user => this.getUserMetrics(user.kerb).then(metrics => ({ kerb: metrics.kerb, name: metrics.name, rating: metrics.rating, reviewCount: metrics.reviewCount, completedQuests: metrics.completedQuests, identityVerificationStatus: metrics.identityVerificationStatus }))));
    }

    async getLeaderboard(viewer) {
        const viewerKerb = actorKerb(viewer);
        const users = await this.users.find({}, { projection: { kerb: 1 } }).toArray();
        const profiles = await Promise.all(users.map(user => this.getUserMetrics(user.kerb)));
        return profiles.filter(profile => profile && (!viewerKerb || profile.kerb !== viewerKerb)).map(profile => ({
            kerb: profile.kerb, name: profile.name, quests: profile.completedQuests,
            completedQuests: profile.completedQuests, postedQuests: profile.postedQuests,
            rating: profile.rating, reviewCount: profile.reviewCount,
            identityVerificationStatus: profile.identityVerificationStatus,
        })).sort((a, b) => b.completedQuests - a.completedQuests || (b.rating ?? 0) - (a.rating ?? 0) || a.name.localeCompare(b.name));
    }

    async getRecommendations(viewer) {
        const identity = actorIdentity(viewer);
        const hasId = schemas.objectId(identity.userId);
        const [viewerRecord, rankedProfiles, quests] = await Promise.all([
            this.users.findOne(hasId ? { _id: new ObjectId(identity.userId) } : { kerb: identity.kerb }, { projection: { blocked: 1, blockedUserIds: 1 } }),
            this.getLeaderboard(viewer),
            this.requests.find({ $and: [{ $or: [...(hasId ? [{ requesterId: new ObjectId(identity.userId) }] : []), ...(identity.kerb ? [{ requester: identity.kerb }] : [])] }, { helper: { $type: "string" }, deletedAt: null }] }).sort({ acceptedAt: -1 }).toArray(),
        ]);
        const blocked = new Set(viewerRecord?.blocked ?? []);
        const allowed = async kerb => !blocked.has(kerb) && !await this.isBlockedEitherWay(viewer, kerb);
        const pastStatuses = new Set(["completed", "cancelled"]);
        const pastAcceptors = [];
        const seen = new Set();
        for (const quest of quests) {
            const kerb = quest.helper;
            if (!pastStatuses.has(normalizeQuestStatus(quest.status)) || seen.has(kerb) || !await allowed(kerb)) continue;
            seen.add(kerb);
            const profile = await this.getUserMetrics(kerb);
            if (profile) pastAcceptors.push({
                kerb, name: profile.name, rating: profile.rating, reviewCount: profile.reviewCount,
                completedQuests: profile.completedQuests, identityVerificationStatus: profile.identityVerificationStatus,
                lastAcceptedAt: quest.acceptedAt ?? quest.createdAt ?? null,
                lastQuestTitle: quest.title ?? quest.description,
            });
        }
        const pastKerbs = new Set(pastAcceptors.map(user => user.kerb));
        const recommendations = [];
        const candidates = rankedProfiles.slice().sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1) || b.completedQuests - a.completedQuests || b.reviewCount - a.reviewCount);
        for (const profile of candidates) {
            if (recommendations.length >= 8) break;
            if (pastKerbs.has(profile.kerb) || !await allowed(profile.kerb)) continue;
            recommendations.push({ ...profile, identityVerificationStatus: profile.identityVerificationStatus ?? "unverified" });
        }
        return { recommendations, pastAcceptors };
    }

    static get REVIEW_TAGS() { return REVIEW_TAGS; }
    static get REVIEW_REPORT_REASONS() { return REVIEW_REPORT_REASONS; }
    static get REVIEW_REPORT_ACTIONS() { return ["hide", "keep"]; }
    static get PAYMENT_METHODS() { return PAYMENT_METHODS; }
    static get DISPUTE_REASONS() { return DISPUTE_REASONS; }
    static get USER_REPORT_REASONS() { return USER_REPORT_REASONS; }
}

module.exports = DBController;
module.exports.ratingSummary = ratingSummary;
module.exports.sanitizeText = sanitizeText;
module.exports.publicQuest = publicQuest;
