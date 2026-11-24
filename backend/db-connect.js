const { MongoClient, ObjectId } = require("mongodb");
require("dotenv").config();
const uri = process.env.MONGODB_URI;

function ratingSummary(user) {
    const ratings = Object.values(user.hasGottenReviewed ?? {}).filter(
        value => Number.isInteger(value) && value >= 1 && value <= 5
    );
    return {
        rating: ratings.length ? ratings.reduce((sum, value) => sum + value, 0) / ratings.length : null,
        reviewCount: ratings.length,
    };
}

function requestExpiry(request) {
    return request.expiresAt ? new Date(request.expiresAt).getTime()
        : request.createdAt ? new Date(request.createdAt).getTime() + 86400000 : Infinity;
}

class DBController {
    constructor() {
        this.client = new MongoClient(uri, {
            family: 4
        });
    }
    async connect() {
        await this.client.connect();
        this.db = this.client.db("sidequest");
        this.requests = this.db.collection("requests");
        this.users = this.db.collection("users");
        this.messages = this.db.collection("messages");
        this.notifications = this.db.collection("notifications");
        this.feedback = this.db.collection("feedback");

        await this.users.createIndex({kerb: 1}, {unique: true});
        await this.requests.createIndex({ requester: 1, createdAt: -1 });
        await this.requests.createIndex({ helper: 1, status: 1 });
        await this.notifications.createIndex({ kerb: 1, createdAt: -1 });
    }
    async getAllRequests() {
        const found = await this.requests.find({ deletedAt: null });
        const requests = await found.toArray();
        const now = Date.now();
        return requests.filter(request => request.status !== 3)
            .map(request => ({ ...request, expired: requestExpiry(request) <= now }));
    }
    async postingLimits(user, now, session) {
        const committed = this.requests.find({
            requester: user.kerb,
            payoutCents: { $exists: true },
            $or: [
                { status: 2 },
                { deletedAt: null, status: 1 },
                { deletedAt: null, status: 0, expiresAt: { $gt: now } },
            ],
        }, { session, projection: { payoutCents: 1 } });
        let availableCents = Math.round((user.earned ?? 0) * 100);
        for await (const request of committed) availableCents -= request.payoutCents;
        return { availableCents: Math.max(0, availableCents) };
    }
    async postRequest(request) {
        return this.client.withSession(session => session.withTransaction(async () => {
            // Serialize posts by this requester before checking their available payout balance.
            const user = await this.users.findOneAndUpdate(
                { kerb: request.requester },
                { $inc: { postingVersion: 1 } },
                { session }
            );
            const now = new Date();
            const limits = await this.postingLimits(user, now, session);
            if (request.payoutCents > limits.availableCents) return { error: "insufficient_funds" };
            const document = {
                ...request, helper: null, status: 0,
                createdAt: now, expiresAt: new Date(now.getTime() + 86400000),
            };
            const { insertedId } = await this.requests.insertOne(document, { session });
            return { request: { ...document, _id: insertedId } };
        }));
    }
    async connectRequest(_id, helper) {
        const id = new ObjectId(_id);
        const candidate = await this.requests.findOne({ _id: id, deletedAt: null, status: { $in: [0, null] } });
        if (!candidate || candidate.requester === helper) return false;
        return this.client.withSession(session => session.withTransaction(async () => {
            // An expiring payout cannot be released while its quest is being accepted.
            await this.users.updateOne({ kerb: candidate.requester }, { $inc: { postingVersion: 1 } }, { session });
            const request = await this.requests.findOne({ _id: id, deletedAt: null, status: { $in: [0, null] }, helper: null }, { session });
            if (!request || requestExpiry(request) <= Date.now()) return false;
            const result = await this.requests.updateOne({ _id: id }, {
                $set: { helper, status: 1, questStage: 0 },
            }, { session });
            return result.modifiedCount === 1;
        }));
    }
    async updateQuestStage(id, helper, stage) {
        const requestId = new ObjectId(id);
        const request = await this.requests.findOne({ _id: requestId, deletedAt: null });
        if (!request || request.helper !== helper || request.status !== 1) return null;
        const questStage = stage === "started" ? 1 : stage === "picked_up" ? 2 : null;
        if (questStage == null || questStage !== (request.questStage ?? 0) + 1) return null;
        const result = await this.requests.updateOne({
            _id: requestId, deletedAt: null, helper, status: 1, questStage: request.questStage ?? null,
        }, { $set: { questStage } });
        return result.modifiedCount ? request : null;
    }
    async resolveRequest(_id, helper) {
        return this.client.withSession(session => session.withTransaction(async () => {
            const request = await this.requests.findOneAndUpdate(
                { _id: new ObjectId(_id), helper, status: 1, questStage: 2, deletedAt: null },
                { $set: { status: 2, questStage: 3, completedAt: new Date() } },
                { session }
            );
            if (!request) return null;
            await this.users.updateOne({ kerb: helper }, {
                $inc: { quests: 1, earned: request.pay },
            }, { session });
            return request;
        }));
    }
    async signup(kerb, name, password) {
    await this.users.insertOne({
            kerb,
            name,
            bio: "",
            password,
            createdAt: new Date(),
            strikes: 0,
            earned: 0,
            quests: 0,
            blocked: [],
            hasReviewed: {},
            hasGottenReviewed: {},
            pfp: null
        });
    }
    async findUser(kerb) {
        return await this.users.findOne({
            kerb
        })
    }
    async findUserPublic(kerb) {
        const user = await findUser(kerb);
        delete user.password, user.blocked, user.hasReviewed;
        return user;
    }
    async ratingEligibleUsers(kerb) {
        const completed = this.requests.find({ status: 2, $or: [{ requester: kerb }, { helper: kerb }] },
            { projection: { requester: 1, helper: 1 } });
        const peers = new Set();
        for await (const quest of completed) {
            const peer = quest.requester === kerb ? quest.helper : quest.requester;
            if (peer && peer !== kerb) peers.add(peer);
        }
        return peers;
    }
    async rateUser(kerb, raterKerb, rating) {
        const completed = await this.requests.findOne({
            status: 2,
            $or: [{ requester: raterKerb, helper: kerb }, { requester: kerb, helper: raterKerb }],
        });
        if (!completed) return null;
        const user = await this.users.findOneAndUpdate({ kerb }, {
            $set: { [`hasGottenReviewed.review-${raterKerb}`]: rating },
        }, { returnDocument: "after" });
        return user ? ratingSummary(user) : null;
    }
    async strike(kerb) {
        const user = await this.users.findOne({kerb});
        await this.users.updateOne({kerb}, {$set:{strikes: user.strikes + 1}});
    }
    async toggleBlock(kerb, dest) {
        const user = await this.users.findOne({
            kerb: kerb
        })
        let blocked = false;
        for (const u of user.blocked) if (u == dest) blocked = true;
        let newBlocked;
        if (blocked) {
            newBlocked = [];
            for (const u of user.blocked) if (u != dest) newBlocked.push(u);
        } else {
            newBlocked = user.blocked;
            newBlocked.push(dest);
        }
        await this.users.updateOne({
            kerb: kerb
        }, {
            $set: {blocked: newBlocked}
        })
    }

    async getPostedRequests(kerb) {
    return this.requests
        .find({ requester: kerb, deletedAt: null })
        .sort({ _id: -1 })
        .toArray();
    }   

    async deleteRequest(id, kerb) {
        return this.requests.updateOne({
            _id: new ObjectId(id), requester: kerb, deletedAt: null,
        }, { $set: { deletedAt: new Date() } });
    }   

    async getRequestById(id) {
        return this.requests.findOne({ _id: new ObjectId(id), deletedAt: null });
    }

    async addNotification(kerb, notification) {
        if (!kerb) return;
        await this.notifications.insertOne({ kerb, ...notification, readAt: null, createdAt: new Date() });
    }

    async getNotifications(kerb) {
        return this.notifications.find({ kerb }).sort({ createdAt: -1 }).limit(50).toArray();
    }

    async markNotificationRead(id, kerb) {
        return this.notifications.updateOne({ _id: new ObjectId(id), kerb }, { $set: { readAt: new Date() } });
    }

    async submitFeedback(kerb, kind, message) {
        const feedback = { kerb, kind, message, createdAt: new Date() };
        const { insertedId } = await this.feedback.insertOne(feedback);
        return { ...feedback, _id: insertedId };
    }

    async cancelQuest(id, kerb) {
        const requestId = new ObjectId(id);
        const request = await this.requests.findOne({ _id: requestId, status: 1, deletedAt: null, $or: [{ requester: kerb }, { helper: kerb }] });
        if (!request) return null;
        const isRequester = request.requester === kerb;
        return this.requests.findOneAndUpdate(
            { _id: requestId, status: 1, deletedAt: null, $or: [{ requester: kerb }, { helper: kerb }] },
            isRequester
                ? { $set: { status: 3, cancelledAt: new Date(), cancelledBy: kerb } }
                : { $set: { helper: null, status: 0, questStage: 0, cancelledAt: new Date(), cancelledBy: kerb } },
        );
    }

    async getQuestMessages(requestId, since = null) {
        const filter = { requestId: new ObjectId(requestId) };
        if (since && Number.isFinite(Date.parse(since))) filter.createdAt = { $gt: new Date(since) };
        return this.messages.find(filter).sort({ createdAt: 1 }).limit(100).toArray();
    }

    async addQuestMessage(requestId, sender, text) {
        const message = { requestId: new ObjectId(requestId), sender, text, createdAt: new Date() };
        const { insertedId } = await this.messages.insertOne(message);
        return { ...message, _id: insertedId };
    }

    async searchUsers(query, viewer) {
        const pattern = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const users = await this.users.find({ $or: [
            { name: { $regex: pattern, $options: "i" } },
            { kerb: { $regex: pattern, $options: "i" } }
        ] }, { projection: { _id: 0, kerb: 1, name: 1, hasGottenReviewed: 1 } }).limit(12).toArray();
        const peers = await this.ratingEligibleUsers(viewer);
        return users.map(user => this.publicRating(user, viewer, peers));
    }

    publicRating(user, viewer, peers) {
        return {
            kerb: user.kerb, name: user.name, ...ratingSummary(user),
            canRate: peers.has(user.kerb),
            yourRating: user.hasGottenReviewed?.[`review-${viewer}`] ?? null,
        };
    }

    async getLeaderboard(viewer) {
        const users = await this.users.find({}, { projection: { _id: 0, kerb: 1, name: 1, quests: 1, hasGottenReviewed: 1, pfp: 1 } }).toArray();
        const peers = await this.ratingEligibleUsers(viewer);
        return users.map(user => ({
            ...this.publicRating(user, viewer, peers),
            quests: user.quests ?? 0, pfp: user.pfp ?? null,
        })).sort((a, b) => b.quests - a.quests || (b.rating ?? 0) - (a.rating ?? 0)
            || a.name.localeCompare(b.name) || a.kerb.localeCompare(b.kerb));
    }
}

module.exports = DBController;
module.exports.ratingSummary = ratingSummary;
