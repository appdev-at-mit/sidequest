import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import session from "express-session";
import MongoStore from "connect-mongo";
import helmet from "helmet";
import cors from "cors";
import { rateLimit } from "express-rate-limit";
import { randomBytes, timingSafeEqual } from "node:crypto";
import mongoose from "mongoose";
import { z } from "zod";
import { config, TERMS_VERSION } from "./config.js";
import { authentication } from "./auth.js";
import {
  User,
  Quest,
  Message,
  Review,
  Report,
  Strike,
  Notification,
  TermsAcceptance,
} from "./models.js";
import { createQuestSchema, searchSchema, idSchema } from "./validation.js";

declare module "express-session" {
  interface SessionData {
    userId?: string;
    csrf?: string;
  }
}
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const fail = (status: number, message: string): never => {
  throw new ApiError(status, message);
};
const publicFields = "_id displayName averageRating ratingCount fictional";
export const participant = (q: any, userId?: string) =>
  Boolean(
    userId &&
    [q.requesterId?._id || q.requesterId, q.performerId?._id || q.performerId]
      .filter(Boolean)
      .some((v) => String(v) === userId),
  );
const mine = (v: any, req: Request) =>
  String(v?._id || v) === req.session.userId;
export function csrfToken(req: Request) {
  return (req.session.csrf ||= randomBytes(32).toString("hex"));
}
export function sessionMiddleware(store?: session.Store) {
  return session({
    name: "sidequest.sid",
    secret: config.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store:
      store || MongoStore.create({ mongoUrl: config.DATABASE_URL, ttl: 86400 }),
    cookie: {
      httpOnly: true,
      secure: config.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 86400000,
    },
  });
}
async function current(req: Request) {
  if (!req.session.userId) fail(401, "Please sign in.");
  const user = await User.findById(req.session.userId);
  if (!user) fail(401, "Session user no longer exists.");
  return user!;
}
async function active(req: Request, terms = false) {
  const user = await current(req);
  if (user.accountStatus !== "ACTIVE")
    fail(403, "Your account cannot perform this action.");
  if (terms && user.termsVersion !== TERMS_VERSION)
    fail(403, "Accept the current terms before posting or accepting a quest.");
  return user;
}
async function admin(req: Request) {
  const user = await active(req);
  if (user.role !== "MODERATOR") fail(403, "Moderator access required.");
  return user;
}
async function quest(req: Request) {
  const q = await Quest.findById(idSchema.parse(req.params.id));
  if (!q) fail(404, "Quest not found.");
  if (q!.status === "OPEN" && q!.deadline <= new Date()) {
    await Quest.updateOne(
      { _id: q!._id, status: "OPEN", deadline: { $lte: new Date() } },
      { $set: { status: "EXPIRED" } },
    );
    return (await Quest.findById(q!._id))!;
  }
  return q!;
}
async function conversation(req: Request) {
  await current(req);
  const q = await quest(req);
  if (!q.performerId || !participant(q, req.session.userId))
    fail(403, "Only accepted quest participants can access chat.");
  return q;
}
const pagination = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
const notify = async (
  userId: any,
  questId: any,
  text: string,
  tx: mongoose.ClientSession,
) => {
  await Notification.create([{ userId, questId, text }], { session: tx });
};
export function createApp(
  options: {
    store?: session.Store;
    emit?: (room: string, event: string, data: any) => void;
  } = {},
) {
  const app = express();
  app.disable("x-powered-by");
  if (config.NODE_ENV === "production") app.set("trust proxy", 1);
  app.use(
    helmet(),
    cors({ origin: config.CLIENT_ORIGIN, credentials: true }),
    express.json({ limit: "16kb" }),
  );
  app.use(
    rateLimit({
      windowMs: 60000,
      limit: config.NODE_ENV === "test" ? 10000 : 180,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  const sessions = sessionMiddleware(options.store);
  app.use(sessions);
  app.locals.sessions = sessions;
  app.use("/api/v1", (req, _res, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const supplied = req.get("x-csrf-token") || "";
      const expected = req.session.csrf || "";
      if (
        !expected ||
        supplied.length !== expected.length ||
        !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
      )
        return next(
          new ApiError(403, "Invalid CSRF token. Refresh and try again."),
        );
      if (req.get("origin") && req.get("origin") !== config.CLIENT_ORIGIN)
        return next(new ApiError(403, "Origin is not allowed."));
    }
    next();
  });
  const api = express.Router();
  app.use("/api/v1", api);
  api.get("/health", async (_req, res) => {
    try {
      await mongoose.connection.db!.admin().ping();
      res.json({ status: "ok", database: "connected" });
    } catch {
      res.status(503).json({ status: "unavailable", database: "disconnected" });
    }
  });
  api.get("/auth/me", async (req, res) => {
    const user = req.session.userId
      ? await User.findById(req.session.userId).select(
          "-questCreationTimes -revision -blockedUserIds",
        )
      : null;
    res.json({
      user,
      csrfToken: csrfToken(req),
      termsVersion: TERMS_VERSION,
      developmentLogin:
        config.NODE_ENV !== "production" && config.AUTH_MODE === "development",
    });
  });
  api.get("/auth/login", (_req, res) =>
    res.redirect(`${config.CLIENT_ORIGIN}/login`),
  );
  api.get("/auth/callback", () =>
    fail(503, "Touchstone SAML service provider is not configured."),
  );
  api.post(
    "/auth/dev-login",
    rateLimit({ windowMs: 60000, limit: 20 }),
    async (req, res) => {
      req.body = z
        .object({ kerberosId: z.string().max(40) })
        .strict()
        .parse(req.body);
      const identity = await authentication.authenticate(req);
      const user = await User.findOne({ kerberosId: identity.kerberosId });
      await new Promise<void>((resolve, reject) =>
        req.session.regenerate((error) => (error ? reject(error) : resolve())),
      );
      req.session.userId = String(user!._id);
      res.json({ userId: user!._id, csrfToken: csrfToken(req) });
    },
  );
  api.post("/auth/logout", (req, res, next) =>
    req.session.destroy((error) => {
      if (error) return next(error);
      res.clearCookie("sidequest.sid", {
        httpOnly: true,
        sameSite: "lax",
        secure: config.NODE_ENV === "production",
      });
      res.json({ ok: true });
    }),
  );
  api.post("/users/me/terms", async (req, res) => {
    const user = await current(req);
    z.object({ version: z.literal(TERMS_VERSION) })
      .strict()
      .parse(req.body);
    await mongoose.connection.transaction(async (tx) => {
      await TermsAcceptance.updateOne(
        { userId: user._id, version: TERMS_VERSION },
        { $setOnInsert: { acceptedAt: new Date() } },
        { upsert: true, session: tx },
      );
      await User.updateOne(
        { _id: user._id },
        { $set: { termsVersion: TERMS_VERSION, termsAcceptedAt: new Date() } },
        { session: tx },
      );
    });
    res.json({ ok: true });
  });
  api.get("/users/me", async (req, res) => {
    const user = await current(req);
    const {
      revision: _r,
      questCreationTimes: _q,
      blockedUserIds: _b,
      ...profile
    } = user.toObject();
    res.json(profile);
  });
  api.patch("/users/me", async (req, res) => {
    const user = await active(req);
    const data = z
      .object({
        displayName: z.string().trim().min(1).max(80).optional(),
        venmoUsername: z
          .string()
          .trim()
          .regex(/^[a-zA-Z0-9_-]{0,30}$/)
          .optional(),
      })
      .strict()
      .parse(req.body);
    res.json(
      await User.findByIdAndUpdate(
        user._id,
        { $set: data },
        { new: true },
      ).select("-revision -questCreationTimes -blockedUserIds"),
    );
  });
  api.get("/users/me/quests", async (req, res) => {
    await current(req);
    const { page, limit } = pagination.parse(req.query);
    res.json(
      await Quest.find({
        $or: [
          { requesterId: req.session.userId },
          { performerId: req.session.userId },
        ],
      })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("requesterId performerId", publicFields),
    );
  });
  api.get("/users/me/notifications", async (req, res) => {
    await current(req);
    res.json(
      await Notification.find({ userId: req.session.userId })
        .sort({ createdAt: -1 })
        .limit(50),
    );
  });
  api.get("/users/me/reports", async (req, res) => {
    await current(req);
    const { page, limit } = pagination.parse(req.query);
    res.json(
      await Report.find({ reporterId: req.session.userId })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
    );
  });
  api.get("/users/:id/reviews", async (req, res) => {
    const { page, limit } = pagination.parse(req.query);
    res.json(
      await Review.find({ revieweeId: idSchema.parse(req.params.id) })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("reviewerId", publicFields),
    );
  });
  api.get("/users/:id", async (req, res) => {
    const user = await User.findById(idSchema.parse(req.params.id)).select(
      publicFields,
    );
    if (!user) fail(404, "User not found.");
    res.json(user);
  });
  api.get("/quests", async (req, res) => {
    const f = searchSchema.parse(req.query);
    const filter: any = {
      status: "OPEN",
      deadline: { $gt: new Date() },
      payCents: { $gte: f.minPayCents, $lte: f.maxPayCents },
    };
    if (f.category) filter.category = f.category;
    if (f.search)
      filter.title = {
        $regex: f.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        $options: "i",
      };
    const sort: any =
      f.sort === "payment"
        ? { payCents: -1, _id: 1 }
        : f.sort === "newest"
          ? { createdAt: -1, _id: 1 }
          : f.sort === "deadline"
            ? { deadline: 1, _id: 1 }
            : { distanceMeters: 1, _id: 1 };
    const [result] = await Quest.aggregate([
      {
        $geoNear: {
          near: { type: "Point", coordinates: [f.longitude, f.latitude] },
          distanceField: "distanceMeters",
          maxDistance: f.radiusMeters,
          spherical: true,
          query: filter,
        },
      },
      { $sort: sort },
      {
        $facet: {
          items: [{ $skip: (f.page - 1) * f.limit }, { $limit: f.limit }],
          count: [{ $count: "total" }],
        },
      },
    ]);
    await Quest.populate(result.items, {
      path: "requesterId",
      select: publicFields,
    });
    res.json({
      items: result.items,
      total: result.count[0]?.total || 0,
      page: f.page,
      limit: f.limit,
    });
  });
  api.post("/quests", async (req, res) => {
    await active(req, true);
    const data = createQuestSchema.parse(req.body);
    let created: any;
    await mongoose.connection.transaction(async (tx) => {
      const now = new Date();
      const cutoff = new Date(now.getTime() - 86400000);
      // Update the same user document to serialize concurrent requests, then insert in the same transaction.
      const user = await User.findOneAndUpdate(
        {
          _id: req.session.userId,
          accountStatus: "ACTIVE",
          termsVersion: TERMS_VERSION,
        },
        { $inc: { revision: 1 } },
        { new: true, session: tx },
      );
      if (!user) fail(403, "Account or terms no longer permits posting.");
      const times = user!.questCreationTimes.filter((t) => t > cutoff);
      if (times.length >= 3)
        fail(429, "You can post at most 3 quests in a rolling 24 hours.");
      if (data.deadline <= now) fail(400, "Deadline has passed.");
      user!.questCreationTimes = [...times, now];
      await user!.save({ session: tx });
      [created] = await Quest.create(
        [{ ...data, requesterId: req.session.userId, createdAt: now }],
        { session: tx },
      );
    });
    res.status(201).json(created);
  });
  api.get("/quests/:id", async (req, res) => {
    const q = await quest(req);
    await q.populate("requesterId performerId", publicFields);
    const result: any = q.toObject();
    if (!participant(q, req.session.userId)) delete result.disputeReason;
    if (participant(q, req.session.userId)) {
      const requester = await User.findById(q.requesterId).select(
        "venmoUsername",
      );
      result.requesterVenmoUsername = requester?.venmoUsername;
    }
    result.overdue =
      ["ACCEPTED", "DISPUTED"].includes(q.status) && q.deadline <= new Date();
    res.json(result);
  });
  api.post("/quests/:id/accept", async (req, res) => {
    await active(req, true);
    const id = idSchema.parse(req.params.id);
    let accepted: any;
    await mongoose.connection.transaction(async (tx) => {
      const user = await User.findOneAndUpdate(
        {
          _id: req.session.userId,
          accountStatus: "ACTIVE",
          termsVersion: TERMS_VERSION,
        },
        { $inc: { revision: 1 } },
        { new: true, session: tx },
      );
      if (!user) fail(403, "Account cannot accept quests.");
      accepted = await Quest.findOneAndUpdate(
        {
          _id: id,
          status: "OPEN",
          deadline: { $gt: new Date() },
          requesterId: { $ne: req.session.userId },
        },
        {
          $set: {
            performerId: req.session.userId,
            status: "ACCEPTED",
            acceptedAt: new Date(),
          },
        },
        { new: true, session: tx },
      );
      if (!accepted) fail(409, "Quest is unavailable, expired, or your own.");
      await notify(
        accepted.requesterId,
        accepted._id,
        "Your quest was accepted. Chat is now available.",
        tx,
      );
    });
    res.json(accepted);
  });
  for (const action of ["submit", "complete", "cancel", "dispute"] as const)
    api.post(`/quests/:id/${action}`, async (req, res) => {
      await active(req);
      let changed: any;
      await mongoose.connection.transaction(async (tx) => {
        const q = await Quest.findById(idSchema.parse(req.params.id)).session(
          tx,
        );
        if (!q) fail(404, "Quest not found.");
        const update: any = {};
        if (action === "submit") {
          if (!mine(q!.performerId, req))
            fail(403, "Only the performer can submit work.");
          if (q!.status !== "ACCEPTED" || q!.workSubmittedAt)
            fail(409, "Work cannot be submitted again.");
          update.workSubmittedAt = new Date();
        } else if (action === "complete") {
          if (!mine(q!.requesterId, req))
            fail(403, "Only the requester can confirm completion.");
          if (q!.status !== "ACCEPTED" || !q!.workSubmittedAt)
            fail(409, "The performer must submit work first.");
          update.status = "COMPLETED";
          update.completedAt = new Date();
        } else if (action === "cancel") {
          if (!mine(q!.requesterId, req))
            fail(403, "Only the requester can cancel.");
          if (
            !["OPEN", "ACCEPTED"].includes(q!.status) ||
            (q!.status === "OPEN" && q!.deadline <= new Date())
          )
            fail(409, "Quest cannot be canceled.");
          if (q!.status === "ACCEPTED")
            z.object({ confirm: z.literal(true) })
              .strict()
              .parse(req.body);
          update.status = "CANCELED";
          update.canceledAt = new Date();
          update.canceledBy = req.session.userId;
          update.cancellationStage =
            q!.status === "OPEN" ? "BEFORE_ACCEPTANCE" : "AFTER_ACCEPTANCE";
        } else {
          if (!participant(q, req.session.userId))
            fail(403, "Only participants can dispute.");
          if (q!.status !== "ACCEPTED")
            fail(409, "Only accepted quests can be disputed.");
          const data = z
            .object({ reason: z.string().trim().min(5).max(1000) })
            .strict()
            .parse(req.body);
          update.status = "DISPUTED";
          update.disputeReason = data.reason;
          await Report.create(
            [
              {
                reporterId: req.session.userId,
                questId: q!._id,
                reason: "Quest dispute",
                description: data.reason,
              },
            ],
            { session: tx },
          );
        }
        changed = await Quest.findOneAndUpdate(
          {
            _id: q!._id,
            status: q!.status,
            workSubmittedAt: q!.workSubmittedAt || null,
          },
          { $set: update },
          { new: true, session: tx },
        );
        if (!changed) fail(409, "Quest changed. Refresh and retry.");
        const other = mine(q!.requesterId, req)
          ? q!.performerId
          : q!.requesterId;
        if (other) await notify(other, q!._id, `Quest update: ${action}.`, tx);
      });
      res.json(changed);
    });
  api.get("/quests/:id/messages", async (req, res) => {
    const q = await conversation(req);
    const { page, limit } = pagination.parse(req.query);
    // Pages are newest-first, each page is rendered chronologically.
    const messages = await Message.find({ questId: q._id })
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("senderId", publicFields);
    await Message.updateMany(
      { questId: q._id, senderId: { $ne: req.session.userId }, readAt: null },
      { $set: { readAt: new Date() } },
    );
    res.json(messages.reverse());
  });
  api.post(
    "/quests/:id/messages",
    rateLimit({
      windowMs: 60000,
      limit: config.NODE_ENV === "test" ? 1000 : 30,
    }),
    async (req, res) => {
      await active(req);
      const data = z
        .object({ content: z.string().trim().min(1).max(2000) })
        .strict()
        .parse(req.body);
      let message: any;
      await mongoose.connection.transaction(async (tx) => {
        const q = await Quest.findById(idSchema.parse(req.params.id)).session(
          tx,
        );
        if (!q || !q.performerId || !participant(q, req.session.userId))
          fail(403, "Only accepted participants can send messages.");
        if (!["ACCEPTED", "DISPUTED"].includes(q!.status))
          fail(409, "Chat is read-only after closure.");
        await Quest.updateOne(
          { _id: q!._id },
          { $set: { updatedAt: new Date() } },
          { session: tx },
        );
        [message] = await Message.create(
          [{ questId: q!._id, senderId: req.session.userId, ...data }],
          { session: tx },
        );
      });
      options.emit?.(String(message.questId), "message", {
        questId: message.questId,
      });
      res.status(201).json(message);
    },
  );
  api.post("/quests/:id/reviews", async (req, res) => {
    await active(req);
    const data = z
      .object({
        rating: z.number().int().min(1).max(5),
        comment: z.string().trim().max(500).optional(),
      })
      .strict()
      .parse(req.body);
    let review: any;
    await mongoose.connection.transaction(async (tx) => {
      const q = await Quest.findById(idSchema.parse(req.params.id)).session(tx);
      if (!q || !participant(q, req.session.userId))
        fail(403, "Only participants can review.");
      if (q!.status !== "COMPLETED")
        fail(409, "Reviews require completed work.");
      const revieweeId = mine(q!.requesterId, req)
        ? q!.performerId
        : q!.requesterId;
      const reviewee = await User.findOneAndUpdate(
        { _id: revieweeId },
        { $inc: { revision: 1 } },
        { new: true, session: tx },
      );
      [review] = await Review.create(
        [
          {
            ...data,
            questId: q!._id,
            reviewerId: req.session.userId,
            revieweeId,
          },
        ],
        { session: tx },
      );
      const count = reviewee!.ratingCount;
      await User.updateOne(
        { _id: revieweeId },
        {
          $set: {
            ratingCount: count + 1,
            averageRating:
              (reviewee!.averageRating * count + data.rating) / (count + 1),
          },
        },
        { session: tx },
      );
    });
    res.status(201).json(review);
  });
  api.post("/reports", async (req, res) => {
    await current(req);
    const data = z
      .object({
        reportedUserId: idSchema.optional(),
        questId: idSchema.optional(),
        messageId: idSchema.optional(),
        reason: z.string().trim().min(3).max(100),
        description: z.string().trim().min(5).max(2000),
      })
      .strict()
      .parse(req.body);
    if (data.questId && !(await Quest.exists({ _id: data.questId })))
      fail(404, "Quest not found.");
    if (
      data.reportedUserId &&
      !(await User.exists({ _id: data.reportedUserId }))
    )
      fail(404, "User not found.");
    if (data.messageId) {
      const m = await Message.findById(data.messageId);
      const q = m && (await Quest.findById(m.questId));
      if (!q || !participant(q, req.session.userId))
        fail(403, "Cannot report an inaccessible message.");
      if (data.questId && data.questId !== String(q!._id))
        fail(400, "Message does not belong to this quest.");
    }
    res
      .status(201)
      .json(await Report.create({ ...data, reporterId: req.session.userId }));
  });
  api.get("/admin/reports", async (req, res) => {
    await admin(req);
    const { page, limit } = pagination.parse(req.query);
    res.json(
      await Report.find()
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("reporterId reportedUserId", publicFields),
    );
  });
  api.post("/admin/reports/:id/resolve", async (req, res) => {
    await admin(req);
    const data = z
      .object({
        status: z.enum(["UNDER_REVIEW", "RESOLVED", "DISMISSED"]),
        resolution: z.string().trim().min(5).max(1000),
        questResolution: z.enum(["COMPLETED", "CANCELED"]).optional(),
      })
      .strict()
      .parse(req.body);
    let report: any;
    await mongoose.connection.transaction(async (tx) => {
      report = await Report.findByIdAndUpdate(
        idSchema.parse(req.params.id),
        {
          $set: {
            status: data.status,
            resolution: data.resolution,
            resolvedBy: req.session.userId,
            resolvedAt: ["RESOLVED", "DISMISSED"].includes(data.status)
              ? new Date()
              : undefined,
          },
        },
        { new: true, session: tx },
      );
      if (!report) fail(404, "Report not found.");
      if (data.questResolution) {
        if (data.status !== "RESOLVED" || !report.questId)
          fail(400, "Quest resolution requires a resolved quest report.");
        const q = await Quest.findOneAndUpdate(
          { _id: report.questId, status: "DISPUTED" },
          {
            $set:
              data.questResolution === "COMPLETED"
                ? { status: "COMPLETED", completedAt: new Date() }
                : {
                    status: "CANCELED",
                    canceledAt: new Date(),
                    canceledBy: req.session.userId,
                    cancellationStage: "AFTER_ACCEPTANCE",
                  },
          },
          { new: true, session: tx },
        );
        if (!q) fail(409, "Quest is not disputed.");
        await notify(
          q!.requesterId,
          q!._id,
          `Moderator resolved dispute: ${data.questResolution}.`,
          tx,
        );
        await notify(
          q!.performerId,
          q!._id,
          `Moderator resolved dispute: ${data.questResolution}.`,
          tx,
        );
      }
    });
    res.json(report);
  });
  async function refreshStrikes(userId: any, tx: mongoose.ClientSession) {
    const count = await Strike.countDocuments({
      userId,
      revokedAt: null,
    }).session(tx);
    const user = await User.findById(userId).session(tx);
    await User.updateOne(
      { _id: userId },
      {
        $set: {
          strikeCount: count,
          accountStatus:
            user!.accountStatus === "BANNED"
              ? "BANNED"
              : count >= config.STRIKE_THRESHOLD
                ? "SUSPENDED"
                : "ACTIVE",
        },
      },
      { session: tx },
    );
  }
  api.get("/admin/users/:id/strikes", async (req, res) => {
    await admin(req);
    res.json(
      await Strike.find({ userId: idSchema.parse(req.params.id) })
        .sort({ createdAt: -1 })
        .limit(50),
    );
  });
  api.post("/admin/users/:id/strikes", async (req, res) => {
    await admin(req);
    const userId = idSchema.parse(req.params.id);
    const data = z
      .object({
        relatedReportId: idSchema,
        reason: z.string().trim().min(5).max(1000),
      })
      .strict()
      .parse(req.body);
    let strike: any;
    await mongoose.connection.transaction(async (tx) => {
      const report = await Report.findOne({
        _id: data.relatedReportId,
        status: { $in: ["UNDER_REVIEW", "RESOLVED"] },
      }).session(tx);
      if (!report) fail(400, "Review a report before issuing a strike.");
      if (report!.reportedUserId && String(report!.reportedUserId) !== userId)
        fail(400, "Report names a different user.");
      if (!report!.reportedUserId && report!.questId) {
        const q = await Quest.findById(report!.questId).session(tx);
        if (!q || !participant(q, userId))
          fail(400, "User is not a participant in the reported quest.");
      }
      if (!report!.reportedUserId && !report!.questId)
        fail(
          400,
          "Report must identify the user or quest before issuing a strike.",
        );
      const user = await User.findByIdAndUpdate(
        userId,
        { $inc: { revision: 1 } },
        { new: true, session: tx },
      );
      if (!user) fail(404, "User not found.");
      [strike] = await Strike.create(
        [{ ...data, userId, issuedBy: req.session.userId }],
        { session: tx },
      );
      await refreshStrikes(userId, tx);
    });
    res.status(201).json(strike);
  });
  api.post("/admin/strikes/:id/revoke", async (req, res) => {
    await admin(req);
    let strike: any;
    await mongoose.connection.transaction(async (tx) => {
      const original = await Strike.findById(
        idSchema.parse(req.params.id),
      ).session(tx);
      if (!original || original.revokedAt)
        fail(409, "Strike is missing or already revoked.");
      await User.updateOne(
        { _id: original!.userId },
        { $inc: { revision: 1 } },
        { session: tx },
      );
      strike = await Strike.findByIdAndUpdate(
        original!._id,
        { $set: { revokedAt: new Date(), revokedBy: req.session.userId } },
        { new: true, session: tx },
      );
      await refreshStrikes(original!.userId, tx);
    });
    res.json(strike);
  });
  app.use((_req, _res, next) => next(new ApiError(404, "Endpoint not found.")));
  app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof z.ZodError)
      return res.status(400).json({
        error: error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      });
    if (error.code === 11000)
      return res.status(409).json({ error: "This entry already exists." });
    if (error.name === "ValidationError" || error.name === "CastError")
      return res.status(400).json({ error: "Invalid document values." });
    const status =
      error.status || (error.name?.startsWith("Mongo") ? 503 : 500);
    if (status >= 500)
      console.error("Request failed:", error.name, error.code || "internal");
    res.status(status).json({
      error:
        status >= 500
          ? "Service unavailable. Try again shortly."
          : error.message,
    });
  });
  return app;
}
