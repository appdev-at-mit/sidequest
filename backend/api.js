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

app.use(express.json());
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
let dummyPasswordHash;

function validCredentials(kerb, password) {
    return typeof kerb === "string" && kerb.length > 0 && kerb.length <= 64
        && typeof password === "string" && password.length > 0 && password.length <= 256;
}

(async () => {
    await db.connect();
    dummyPasswordHash = await argon2.hash("unused authentication placeholder");

    console.log("Successfully connected");

    app.get("/api/auth-status", (req, res) => {
        res.json({
            isLoggedIn: req.isAuthenticated()
        });
    });


    app.post("/api/post-request", async (req, res) => {
        if (!req.isAuthenticated()) {
            res.status(401).json({
                result: "fail",
                msg: "You need to log in first"
            })
            return;
        }
        const { description, pay, start, end, lat, lng } = req.body ?? {};
        const hasLocation = lat != null || lng != null;
        if (typeof description !== "string" || !description.trim() || description.trim().length > 1000
            || !Number.isFinite(pay) || pay <= 0) {
            return res.status(400).json({ result: "fail", msg: "Enter a description and a payout above zero." });
        }
        if (typeof start !== "string" || typeof end !== "string" || !(Date.parse(end) > Date.parse(start))) {
            return res.status(400).json({ result: "fail", msg: "Choose a deadline after the start time." });
        }
        if (hasLocation && (!Number.isFinite(lat) || Math.abs(lat) > 90
            || !Number.isFinite(lng) || Math.abs(lng) > 180)) {
            return res.status(400).json({ result: "fail", msg: "Choose a valid location on the map." });
        }

        const request = await db.postRequest({
            requester: req.user.kerb,
            description: description.trim(),
            pay,
            start,
            end,
            ...(hasLocation ? { lat, lng } : {}),
        });
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
                    res.json({ result: "success", msg: "Logged in", kerb: user.kerb });
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
        res.status(200).json({
            result: "success",
            data: await db.getAllRequests()
        })
    })

     app.get("/api/profile", (req, res) => {
        if (!req.isAuthenticated()) {
            return res.status(401).json({
                msg: "You need to log in first"
            });
        }

        res.json({
            kerb: req.user.kerb,
            name: req.user.name,
            createdAt: req.user.createdAt ?? null
        });
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
            const result = await db.deleteRequest(id, req.user.kerb);

            if (result.deletedCount === 0) {
                return res.status(404).json({
                    msg: "Request not found or not owned by you"
                });
            }

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
            await db.connectRequest(_id, req.body.helper);
            res.status(200).json({
                result: "success",
                msg: "connected request to " + req.body.helper
            })
        } catch (e) {
            res.status(400).json({
                result: "fail",
                msg: "Bad request"
            })
        }
    })
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
            await db.resolveRequest(_id);
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
        if (!req.isAuthenticated()) {
            res.status(401).json({
                result: "fail",
                msg: "You need to log in first"
            })
            return;
        }
        try {
            await db.rateUser(req.body.kerb, req.user.kerb, req.body.rating);
            res.status(200).json({
                result: "success",
                msg: "rated" + req.body.rating
            })
        } catch (e) {
            res.status(400).json({
                result: "fail",
                msg: "Bad request"
            })
        }
    })

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