import express from "express";
import DBController from "./db-connect.js";
import cookieParser from "cookie-parser";
import passport from "passport";
import {Strategy as LocalStrategy} from "passport-local";
import session from "express-session";
import argon2 from "argon2";
import dotenv from "dotenv";
import MongoStore from "connect-mongo";
import path from "path";
dotenv.config();

const app = express();
app.use(express.json());
app.use(cookieParser(process.env.SECRET));
app.use(session({
    secret: process.env.SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        mongoUrl: process.env.MONGODB_URI
    })
}));
app.use(passport.initialize());
app.use(passport.session());
console.log("Request logger loaded");

app.use((req, res, next) => {
    console.log(req.method, req.path, req.isAuthenticated());
    next();
});

app.use((req, res, next) => {
    console.log({
        method: req.method,
        path: req.path,
        hasSessionCookie: Boolean(req.cookies["connect.sid"]),
        sessionUser: req.session.passport?.user ?? null,
        authenticated: req.isAuthenticated()
    });

    next();
});

app.use(express.static(path.resolve("../frontend/dist")));


passport.use(new LocalStrategy({usernameField: "kerb"},
    async (kerb, password, done) => {
        try {
            const theUser = await db.findUser(kerb);
            const storedHash = theUser.password;
            const correct = await argon2.verify(storedHash, password);
            if (correct) {
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

(async () => {
    await db.connect();

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
        const body = req.body;
        await db.postRequest({
            ...body,
            requester: req.user.kerb
        });
        res.status(200).json({
            result: "success",
            msg: "Created request"
        })
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
        const body = req.body;
        try {
            const pw = await argon2.hash(body.password);
            await db.signup(body.kerb, body.name, pw);
            
            res.cookie("username", body.name).status(200).json({
                result: "success",
                msg: `Created user from kerb ${body.kerb} and name ${body.name}`
            })
        } catch (e) {
            console.error("Signup failed:", e);

            res.status(400).send({
                result: "fail",
                msg: "Could not create account"
            });
        }
    })

   

    app.post("/api/login", passport.authenticate("local"), (req, res) => {
        if (!req.user) {
            res.status(400).json({
                result: "fail",
                msg: "Could not log in"
            })
        } else {
            res.status(200).json({
                result: "success",
                msg: "Logged in",
                kerb: req.user.kerb,
                session: req.sessionID
            })
        }
    })

    app.delete("/api/logout", async (req, res, next) => {
        await req.logout(e => {
            if (e) return next(e);
            res.status(200).json({
                result: "success",
                msg: "logged out"
            })
        })
    })

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

    app.listen(3000);
})();