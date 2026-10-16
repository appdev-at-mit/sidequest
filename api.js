import express from "express";
import DBController from "./db-connect.js";

const app = express();
app.use(express.json());
const db = new DBController();

(async () => {
    await db.connect();

    console.log("Successfully connected");

    app.post("/api/post-request", async (req, res) => {
        const body = req.body;
        await db.postRequest(body);
        res.status(200).send(JSON.stringify({
            result: "success",
            msg: "Created request"
        }), {
            "Content-type": "application/json"
        })
    })

    app.post("/api/signup", async (req, res) => {
        const body = req.body;
        try {
            await db.signup(body);
            res.status(200).send(JSON.stringify({
                result: "success",
                msg: `Created user from kerb ${body.kerb} and name ${body.name}`
            }), {
                "Content-type": "application/json"
            })
        } catch (e) {
            res.status(400).send(JSON.stringify({
                result: "fail",
                msg: `User already exists with this kerb`
            }), {
                "Content-type": "application/json"
            })
        }
    })

    app.get("/api/get-all-requests", async (req, res) => {
        console.log(await db.getAllRequests());
    })

    app.get("/", async (req, res) => {
        res.status(200).send("<b>Hello world</b>", {
            "Content-type": "text/html"
        })
    })

    app.listen(3000);
})();