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
    async signup(body) {
        await this.users.insertOne({
            kerb: body.kerb,
            name: body.name,
            strikes: 0,
            blocked: []
        })
    }
}

module.exports = DBController;