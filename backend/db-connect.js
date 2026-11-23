const { MongoClient, ObjectId } = require("mongodb");
require("dotenv").config();
const uri = process.env.MONGODB_URI;

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

        await this.users.createIndex({kerb: 1}, {unique: true});
    }
    async getAllRequests() {
        const found = await this.requests.find();
        return found.toArray();
    }
    async postRequest(request) {
        const document = { ...request, helper: null, status: 0 };
        const { insertedId } = await this.requests.insertOne(document);
        return { ...document, _id: insertedId };
    }
    async connectRequest(_id, helper) {
        const request = await this.requests.findOne({_id});
        if (request.helper === null) {
            await this.requests.updateOne({_id}, {$set:{helper, status:1}});
        }
    }
    async resolveRequest(_id) {
        const request = await this.requests.findOne({_id});
        if (request.helper !== null) {
            await this.requests.updateOne({_id}, {$set:{status:2}});
            const kerb = request.helper;
            const user = await this.findUser(kerb);
            await this.users.updateOne({kerb}, {$set: {
                quests: user.quests + 1,
                earned: user.earned + request.pay
            }})
        }
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
    async rateUser(kerb, raterKerb, rating) {
        const user = await this.users.findOne({kerb});
        const rater = await this.users.findOne({raterKerb});
        user.hasGottenReviewed[`review-${raterKerb}`] = rating;
        rater.hasReviewed[`review-${kerb}`] = rating;
        await this.users.updateOne({raterKerb}, {$set:{hasReviewed: user.hasReviewed}});
        await this.users.updateOne({kerb}, {$set:{hasGottenReviewed: user.hasGottenReviewed}});
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
        .find({ requester: kerb })
        .sort({ _id: -1 })
        .toArray();
    }   

    async deleteRequest(id, kerb) {
        return this.requests.deleteOne({
            _id: new ObjectId(id),
            requester: kerb
        });
    }   
}

module.exports = DBController;