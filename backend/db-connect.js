const { MongoClient, ObjectId } = require("mongodb");
const { canTransition, normalizeQuestStatus } = require("./quest-lifecycle.js");
const { schemas } = require("./validation.js");
require("dotenv").config();

const uri = process.env.MONGODB_URI;
const ACTIVE_TRANSACTION_STATES = ["in_progress", "pending_review", "awaiting_payment", "payment_sent"];
const PAYMENT_METHODS = ["Cash", "PayPal", "Venmo", "Cash App", "Zelle", "Other"];
const DISPUTE_REASONS = ["Requester failed to pay", "Completer failed to complete the quest", "Quest requirements were misrepresented", "Payment amount was incorrect", "Harassment or inappropriate behavior", "Other"];
const REVIEW_FIELDS = {
    requester: ["completionQuality", "communication", "reliability"],
    completer: ["paymentReliability", "descriptionAccuracy", "communication"],
};
const USER_REPORT_REASONS = ["Harassment or inappropriate behavior", "Fraud or misleading conduct", "Spam", "Other"];

function actorIdentity(actor) {
    if (actor instanceof ObjectId) return { userId: String(actor), kerb: "" };
    if (actor && typeof actor === "object") return { userId: typeof actor.userId === "string" ? actor.userId : typeof actor.id === "string" ? actor.id : "", kerb: typeof actor.kerb === "string" ? actor.kerb : "" };
    return { userId: "", kerb: typeof actor === "string" ? actor : "" };
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
    const values = reviews.map(review => Object.values(review.ratings ?? {})).flat().filter(value => Number.isInteger(value) && value >= 1 && value <= 5);
    return {
        rating: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
        reviewCount: reviews.length,
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
    const result = { ...request, status: normalizeQuestStatus(request.status), rewardCents, pay: rewardCents / 100, expiresAt: Number.isFinite(expiry) ? new Date(expiry) : null, expired: expiry <= Date.now() };
    delete result.idempotencyKey;
    delete result.payloadFingerprint;
    delete result.requesterId;
    delete result.helperId;
    if (!viewerIsParty) {
        delete result.agreementSnapshot;
        delete result.completionSubmission;
        delete result.statusHistory;
        delete result.disputedFromStatus;
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
        this.client = new MongoClient(uri, { family: 4 });
    }

    async connect() {
        await this.client.connect();
        this.db = this.client.db("sidequest");
        this.requests = this.db.collection("requests");
        this.users = this.db.collection("users");
        this.messages = this.db.collection("messages");
        this.notifications = this.db.collection("notifications");
        this.feedback = this.db.collection("feedback");
        this.reviews = this.db.collection("questReviews");
        this.disputes = this.db.collection("disputes");
        this.reports = this.db.collection("userReports");
        this.adminAudit = this.db.collection("adminAudit");

        await this.users.createIndex({ kerb: 1 }, { unique: true });
        await this.users.createIndex({ identityProvider: 1, externalIdentityId: 1 }, { unique: true, partialFilterExpression: { externalIdentityId: { $type: "string" } }, name: "external_identity" });
        await this.requests.createIndex({ requester: 1, createdAt: -1 });
        await this.requests.createIndex({ requesterId: 1, createdAt: -1 });
        await this.requests.createIndex({ helperId: 1, status: 1 });
        await this.requests.createIndex({ requester: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } }, name: "request_idempotency" });
        await this.requests.createIndex({ requesterId: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" }, requesterId: { $type: "objectId" } }, name: "request_idempotency_by_user" });
        await this.requests.createIndex({ helper: 1, status: 1 });
        await this.requests.createIndex({ expiresAt: 1, status: 1 });
        await this.notifications.createIndex({ kerb: 1, createdAt: -1 });
        await this.notifications.createIndex({ userId: 1, createdAt: -1 });
        await this.reviews.createIndex({ questId: 1, reviewer: 1 }, { unique: true });
        await this.reviews.createIndex({ questId: 1, reviewerId: 1 }, { unique: true, partialFilterExpression: { reviewerId: { $type: "objectId" } }, name: "review_once_by_user" });
        await this.disputes.createIndex({ status: 1, createdAt: 1 });
        await this.reports.createIndex({ status: 1, createdAt: 1 });
        await this.adminAudit.createIndex({ createdAt: -1 });
        await this.initializeIdentitySchema();
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
                    pay: rewardCents / 100,
                    helper: null,
                    status: "open",
                    createdAt: now,
                    expiresAt: new Date(Date.parse(request.end)),
                    statusHistory: [{ from: null, to: "open", by: request.requester, at: now }],
                };
                const { insertedId } = await this.requests.insertOne(document, { session });
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
        if (!quest || normalizeQuestStatus(quest.status) !== "open" || requestExpiry(quest) <= Date.now()) return null;
        const filter = { $and: [{ _id: quest._id, deletedAt: null, status: quest.status }, identityClause(requester, "requesterId", "requester")] };
        if (quest.end != null) filter.end = quest.end;
        else if (quest.expiresAt) filter.expiresAt = quest.expiresAt;
        else if (quest.createdAt) filter.createdAt = quest.createdAt;
        const result = await this.requests.updateOne(filter, { $set: changes });
        return result.matchedCount ? this.getRequestById(id) : null;
    }

    async connectRequest(id, helper) {
        const helperKerb = actorKerb(helper);
        const helperId = actorIdentity(helper).userId;
        const requestId = new ObjectId(id);
        const candidate = await this.requests.findOne({ _id: requestId, deletedAt: null });
        if (!candidate || (candidate.requester === helperKerb && (!candidate.requesterId || String(candidate.requesterId) === helperId)) || normalizeQuestStatus(candidate.status) !== "open" || requestExpiry(candidate) <= Date.now()) return null;
        const result = await this.client.withSession(session => session.withTransaction(async () => {
            const helperSelector = schemas.objectId(helperId) ? { _id: new ObjectId(helperId) } : { kerb: helperKerb };
            const helperUser = await this.users.findOneAndUpdate(helperSelector, { $inc: { questActivityVersion: 1 } }, { session, returnDocument: "after" });
            if (!helperUser || helperUser.moderationStatus === "permanently_suspended" || (helperUser.moderationStatus === "suspended" && (!helperUser.suspendedUntil || helperUser.suspendedUntil > new Date()))) return null;
            if (candidate.requesterId && String(candidate.requesterId) === String(helperUser._id)) return null;
            if (await this.isBlockedEitherWay({ userId: candidate.requesterId ? String(candidate.requesterId) : "", kerb: candidate.requester }, { userId: String(helperUser._id), kerb: helperKerb }, session)) return null;
            const now = new Date();
            const filter = { _id: requestId, helper: null, deletedAt: null };
            if (candidate.end != null) filter.end = candidate.end;
            else if (candidate.expiresAt) filter.expiresAt = candidate.expiresAt;
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
                acceptedAt: now,
                paymentMethod: PAYMENT_METHODS.includes(candidate.paymentMethod)
                    ? candidate.paymentMethod
                    : PAYMENT_METHODS.includes(helperUser?.preferredPaymentMethod) ? helperUser.preferredPaymentMethod : null,
                paymentInstructions: sanitizeText(helperUser?.paymentInstructions, 160),
            };
            const updated = await this.requests.findOneAndUpdate(filter, {
                $set: { helper: helperKerb, helperId: helperUser._id, status: "in_progress", questStage: 0, acceptedAt: now, agreementSnapshot: snapshot },
                $push: { statusHistory: { from: "open", to: "in_progress", by: helperKerb, at: now } },
            }, { session, returnDocument: "after" });
            return updated;
        }));
        return result;
    }

    async expireUnattendedQuests(now = new Date()) {
        const cutoff = new Date(now.getTime() - 86400000);
        const candidates = await this.requests.find({ status: { $in: ["open", 0] }, deletedAt: null }, {
            projection: { _id: 1, requester: 1, status: 1, end: 1, expiresAt: 1, createdAt: 1 },
        }).toArray();
        const expired = candidates.filter(quest => requestExpiry(quest) <= cutoff.getTime());
        if (!expired.length) return 0;
        const operations = expired.map(quest => {
            const filter = { _id: quest._id, requester: quest.requester, status: quest.status, deletedAt: null };
            if (quest.end != null) filter.end = quest.end;
            else if (quest.expiresAt) filter.expiresAt = quest.expiresAt;
            else if (quest.createdAt) filter.createdAt = quest.createdAt;
            return { updateOne: { filter, update: { $set: { deletedAt: now, deletionReason: "unattended_after_deadline" } } } };
        });
        const result = await this.requests.bulkWrite(operations, { ordered: false });
        return result.modifiedCount;
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

    async submitCompletion(id, helper, description, evidence) {
        const now = new Date();
        const quest = await this.requests.findOne({ $and: [{ _id: new ObjectId(id), deletedAt: null }, identityClause(helper, "helperId", "helper")] });
        if (!quest || normalizeQuestStatus(quest.status) !== "in_progress") return null;
        return this.requests.findOneAndUpdate(
            { $and: [{ _id: quest._id, status: quest.status, deletedAt: null }, identityClause(helper, "helperId", "helper")] },
            { $set: { status: "pending_review", completionSubmission: { description, evidence, submittedAt: now, submittedById: quest.helperId ?? null }, completionSubmittedAt: now },
                $push: { statusHistory: { from: "in_progress", to: "pending_review", by: actorKerb(helper), at: now } } },
            { returnDocument: "after" }
        );
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

    async cancelQuest(id, actor) {
        const quest = await this.requests.findOne({ _id: new ObjectId(id), deletedAt: null });
        if (!quest || !(matchesIdentity(quest, actor, "requesterId", "requester") || matchesIdentity(quest, actor, "helperId", "helper"))) return null;
        const status = normalizeQuestStatus(quest.status);
        if (!canTransition(status, "cancelled")) return null;
        return this.changeQuestState({ id, actor: actorKerb(actor), from: status, to: "cancelled", fields: { cancelledAt: new Date(), cancelledBy: actorKerb(actor), cancelledById: schemas.objectId(actorIdentity(actor).userId) ? new ObjectId(actorIdentity(actor).userId) : null } });
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

    async submitReview(id, reviewer, ratings, text) {
        const quest = await this.requests.findOne({ _id: new ObjectId(id), paymentConfirmedAt: { $type: "date" }, deletedAt: null });
        if (!quest || normalizeQuestStatus(quest.status) !== "completed") return null;
        const reviewerIsRequester = matchesIdentity(quest, reviewer, "requesterId", "requester");
        const reviewerIsHelper = matchesIdentity(quest, reviewer, "helperId", "helper");
        if (!quest || (!reviewerIsRequester && !reviewerIsHelper) || String(quest.requesterId ?? quest.requester) === String(quest.helperId ?? quest.helper)) return null;
        const target = reviewerIsRequester ? quest.helper : quest.requester;
        const targetId = reviewerIsRequester ? quest.helperId : quest.requesterId;
        const expected = REVIEW_FIELDS[reviewerIsRequester ? "requester" : "completer"];
        if (!target || !expected.every(field => Number.isInteger(ratings?.[field]) && ratings[field] >= 1 && ratings[field] <= 5)) return null;
        const review = { questId: quest._id, reviewer: actorKerb(reviewer), reviewerId: reviewerIsRequester ? quest.requesterId : quest.helperId, target, targetId, role: reviewerIsRequester ? "requester" : "completer", ratings: Object.fromEntries(expected.map(key => [key, ratings[key]])), text, createdAt: new Date() };
        const { insertedId } = await this.reviews.insertOne(review);
        return { ...review, _id: insertedId };
    }

    async hasReviewed(id, reviewer) {
        const identity = actorIdentity(reviewer);
        const reviewerQuery = schemas.objectId(identity.userId)
            ? { $or: [{ reviewerId: new ObjectId(identity.userId) }, { reviewerId: { $in: [null] }, reviewer: identity.kerb }] }
            : { reviewer: identity.kerb };
        return Boolean(await this.reviews.findOne({ $and: [{ questId: new ObjectId(id) }, reviewerQuery] }, { projection: { _id: 1 } }));
    }

    async publicReviews(actor) {
        const identity = actorIdentity(actor);
        const hasId = schemas.objectId(identity.userId);
        const reviews = await this.reviews.find({ $or: [...(hasId ? [{ targetId: new ObjectId(identity.userId) }] : []), ...(identity.kerb ? [{ target: identity.kerb }] : [])] }).sort({ createdAt: -1 }).limit(50).toArray();
        return reviews.map(({ _id, questId, role, ratings, text, createdAt }) => ({ id: String(_id), questId: String(questId), role, ratings, text, createdAt }));
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
        const [disputes, reports] = await Promise.all([
            this.disputes.find({ status: "open" }).sort({ createdAt: 1 }).limit(100).toArray(),
            this.reports.find({ status: "open" }).sort({ createdAt: 1 }).limit(100).toArray(),
        ]);
        return { disputes, reports };
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
        return quests.map(quest => publicQuest(quest, actorKerb(actor), true));
    }

    async getRequestById(id) { return this.requests.findOne({ _id: new ObjectId(id), deletedAt: null }); }

    async getQuestForViewer(id, viewer) {
        const quest = await this.getRequestById(id);
        if (!quest) return null;
        const party = matchesIdentity(quest, viewer, "requesterId", "requester") || matchesIdentity(quest, viewer, "helperId", "helper");
        const viewerKerb = actorKerb(viewer);
        const openAndAvailable = normalizeQuestStatus(quest.status) === "open" && requestExpiry(quest) > Date.now();
        if (!party && !openAndAvailable) return null;
        if (!party && quest.requester && await this.isBlockedEitherWay(viewer, { userId: quest.requesterId ? String(quest.requesterId) : "", kerb: quest.requester })) return null;
        return publicQuest(quest, viewerKerb, party);
    }

    async deleteRequest(id, actor) {
        const kerb = actorKerb(actor);
        const quest = await this.requests.findOne({ $and: [{ _id: new ObjectId(id), deletedAt: null }, identityClause(actor, "requesterId", "requester")] });
        if (!quest || normalizeQuestStatus(quest.status) !== "open") return { modifiedCount: 0 };
        return this.requests.updateOne({ $and: [{ _id: quest._id, status: quest.status, deletedAt: null }, identityClause(actor, "requesterId", "requester")] }, { $set: { deletedAt: new Date() } });
    }

    async getQuestMessages(requestId, since = null) {
        const filter = { requestId: new ObjectId(requestId) };
        if (since && Number.isFinite(Date.parse(since))) filter.createdAt = { $gt: new Date(since) };
        return this.messages.find(filter).sort({ createdAt: 1 }).limit(100).toArray();
    }

    async addQuestMessage(requestId, sender, text) {
        const identity = actorIdentity(sender);
        const message = { requestId: new ObjectId(requestId), sender: identity.kerb, senderId: schemas.objectId(identity.userId) ? new ObjectId(identity.userId) : null, text, createdAt: new Date() };
        const { insertedId } = await this.messages.insertOne(message);
        return { ...message, _id: insertedId };
    }

    async addNotification(recipient, notification) {
        const identity = actorIdentity(recipient);
        if (!identity.userId && !identity.kerb) return;
        const user = !identity.userId && identity.kerb ? await this.users.findOne({ kerb: identity.kerb }, { projection: { _id: 1 } }) : null;
        const userId = identity.userId || (user?._id ? String(user._id) : "");
        if (!schemas.objectId(userId) && !identity.kerb) return;
        await this.notifications.insertOne({ kerb: identity.kerb || undefined, userId: schemas.objectId(userId) ? new ObjectId(userId) : null, ...notification, readAt: null, createdAt: new Date() });
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
            this.reviews.find({ $or: [...(hasId ? [{ targetId: new ObjectId(identity.userId) }] : []), ...(kerb ? [{ target: kerb }] : [])] }, { projection: { ratings: 1, text: 1, role: 1, createdAt: 1, questId: 1 } }).sort({ createdAt: -1 }).toArray(),
        ]);
        if (!user) return null;
        const owns = (quest, role) => hasId && quest[`${role}Id`] ? String(quest[`${role}Id`]) === identity.userId : Boolean(kerb && quest[role] === kerb);
        const confirmed = quests.filter(quest => owns(quest, "helper") && normalizeQuestStatus(quest.status) === "completed" && quest.paymentConfirmedAt);
        const paymentSent = quests.filter(quest => owns(quest, "requester") && quest.paymentSentAt);
        const totalRewardCents = confirmed.reduce((sum, quest) => sum + (Number.isSafeInteger(quest.rewardCents) ? quest.rewardCents : Math.round(Number(quest.pay ?? 0) * 100)), 0);
        const summary = ratingSummary(reviews);
        return {
            userId: String(user._id), kerb: user.kerb, name: user.name, createdAt: user.createdAt ?? null,
            identityVerificationStatus: user.identityProvider === "mit-touchstone" && user.externalIdentityId && user.verifiedUniversityIdentityId && user.identityVerificationStatus === "verified" ? "verified" : "unverified",
            ...(includePrivate ? {
                moderationStatus: user.moderationStatus ?? "active",
                preferredPaymentMethod: PAYMENT_METHODS.includes(user.preferredPaymentMethod) ? user.preferredPaymentMethod : "Cash",
                paymentInstructions: user.paymentInstructions ?? "",
            } : {}),
            postedQuests: quests.filter(quest => owns(quest, "requester") && !quest.deletedAt).length,
            completedQuests: confirmed.length,
            confirmedPayments: paymentSent.filter(quest => normalizeQuestStatus(quest.status) === "completed" && quest.paymentConfirmedAt).length,
            paymentConfirmationRate: paymentSent.length ? Math.round(paymentSent.filter(quest => normalizeQuestStatus(quest.status) === "completed" && quest.paymentConfirmedAt).length * 100 / paymentSent.length) : null,
            totalConfirmedEarningsCents: totalRewardCents,
            ...summary,
            reviews,
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

    static get REVIEW_FIELDS() { return REVIEW_FIELDS; }
    static get PAYMENT_METHODS() { return PAYMENT_METHODS; }
    static get DISPUTE_REASONS() { return DISPUTE_REASONS; }
    static get USER_REPORT_REASONS() { return USER_REPORT_REASONS; }
}

module.exports = DBController;
module.exports.ratingSummary = ratingSummary;
module.exports.sanitizeText = sanitizeText;
module.exports.publicQuest = publicQuest;
