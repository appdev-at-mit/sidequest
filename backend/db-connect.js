const { MongoClient } = require("mongodb");
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
    async postRequest(body) {
        await this.requests.insertOne({
            requester: body.requester,
            description: body.description,
            pay: body.pay,
            start: body.start,
            end: body.end
        })
    }
    async signup(kerb, name, password) {
    await this.users.insertOne({
            kerb,
            name,
            password,
            createdAt: new Date(),
            strikes: 0,
            blocked: []
        });
    }
    async findUser(kerb) {
        return await this.users.findOne({
            kerb
        })
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
}

module.exports = DBController;