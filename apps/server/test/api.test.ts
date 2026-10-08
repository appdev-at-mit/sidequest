import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import mongoose from "mongoose";
import session from "express-session";
import request from "supertest";
import { createServer } from "node:http";
import { io as socketClient, type Socket } from "socket.io-client";
import { attachRealtime } from "../src/realtime.js";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app.js";
import { connectDatabase, expireQuests } from "../src/db.js";
import {
  User,
  Quest,
  Review,
  Message,
  Report,
  Strike,
  TermsAcceptance,
  models,
} from "../src/models.js";
import { TERMS_VERSION, config } from "../src/config.js";
const dbName = `sidequest_test_${randomUUID().replaceAll("-", "")}`;
const baseUri =
  process.env.TEST_DATABASE_URL || "mongodb://127.0.0.1:27017/?replicaSet=rs0";
const uri = baseUri.replace(
  /(mongodb(?:\+srv)?:\/\/[^/]+)\/[^?]*/,
  `$1/${dbName}`,
);
let app: ReturnType<typeof createApp>;
let users: any[];
const data = (overrides = {}) => ({
  title: "Bring a notebook to Lobby 7",
  description: "A safe campus delivery of a notebook.",
  category: "DELIVERY",
  payCents: 700,
  startLocation: {
    type: "Point",
    coordinates: [-71.0932, 42.3592],
    label: "Lobby 7",
  },
  deadline: new Date(Date.now() + 3600000).toISOString(),
  ...overrides,
});
async function actor(index: number) {
  const agent = request.agent(app);
  let token = (await agent.get("/api/v1/auth/me")).body.csrfToken;
  const response = await agent
    .post("/api/v1/auth/dev-login")
    .set("x-csrf-token", token)
    .send({ kerberosId: users[index].kerberosId });
  expect(response.status).toBe(200);
  token = response.body.csrfToken;
  return {
    agent,
    token,
    cookie: response.headers["set-cookie"]
      .map((v: string) => v.split(";")[0])
      .join("; "),
    post: (path: string, body = {}) =>
      agent.post(`/api/v1${path}`).set("x-csrf-token", token).send(body),
    get: (path: string) => agent.get(`/api/v1${path}`),
    patch: (path: string, body: any) =>
      agent.patch(`/api/v1${path}`).set("x-csrf-token", token).send(body),
  };
}
async function fixture(overrides = {}) {
  return Quest.create({ ...data(), requesterId: users[0]._id, ...overrides });
}
beforeAll(async () => {
  await connectDatabase(uri);
});
afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
beforeEach(async () => {
  for (const model of models) await model.deleteMany({});
  app = createApp({ store: new session.MemoryStore() });
  users = await User.create(
    [0, 1, 2, 3].map((i) => ({
      kerberosId: `demo-test${i}`,
      displayName: `Test Student ${i}`,
      email: `test${i}@example.invalid`,
      fictional: true,
      termsVersion: TERMS_VERSION,
      termsAcceptedAt: new Date(),
      role: i === 3 ? "MODERATOR" : "STUDENT",
    })),
  );
});
describe("database and validation", () => {
  it("connects to a real replica set and installs required indexes", async () => {
    expect((await request(app).get("/api/v1/health")).body.database).toBe(
      "connected",
    );
    expect(
      (await Quest.collection.indexes()).some(
        (i) => i.key.startLocation === "2dsphere",
      ),
    ).toBe(true);
    expect(
      (await Review.collection.indexes()).some(
        (i) => i.unique && i.key.reviewerId,
      ),
    ).toBe(true);
  });
  it("rejects invalid schemas and duplicate identities", async () => {
    await expect(
      Quest.create({ ...data({ payCents: 2.5 }), requesterId: users[0]._id }),
    ).rejects.toThrow();
    await expect(
      Quest.create({
        ...data(),
        startLocation: {
          type: "Point",
          coordinates: [-181, 91],
          label: "invalid",
        },
        requesterId: users[0]._id,
      }),
    ).rejects.toThrow();
    await expect(
      User.create({
        kerberosId: users[0].kerberosId,
        displayName: "duplicate",
        email: "x@example.invalid",
      }),
    ).rejects.toThrow();
  });
  it("rejects deadlines outside the allowed window and operator injection", async () => {
    const a = await actor(0);
    expect(
      (
        await a.post(
          "/quests",
          data({ deadline: new Date(Date.now() + 90000000) }),
        )
      ).status,
    ).toBe(400);
    expect((await a.get("/quests?minPayCents[$gt]=0")).status).toBe(400);
  });
});
describe("creation and atomic limits", () => {
  it("creates a valid quest with integer cents and server-owned identity", async () => {
    const a = await actor(0);
    const res = await a.post("/quests", data());
    expect(res.status).toBe(201);
    expect(res.body.requesterId).toBe(String(users[0]._id));
    expect(res.body.payCents).toBe(700);
    expect(
      (await a.post("/quests", data({ status: "COMPLETED" }))).status,
    ).toBe(400);
  });
  it("counts canceled and expired quests toward the rolling quota", async () => {
    const a = await actor(0);
    for (let i = 0; i < 3; i++) {
      const res = await a.post("/quests", data());
      await a.post(`/quests/${res.body._id}/cancel`);
    }
    expect((await a.post("/quests", data())).status).toBe(429);
    await User.updateOne(
      { _id: users[0]._id },
      { $set: { questCreationTimes: [new Date(Date.now() - 86400001)] } },
    );
    expect((await a.post("/quests", data())).status).toBe(201);
  });
  it("allows exactly three simultaneous creation requests", async () => {
    const a = await actor(0);
    const results = await Promise.all(
      Array.from({ length: 8 }, () => a.post("/quests", data())),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    expect(results.filter((r) => r.status === 429)).toHaveLength(5);
    expect(await Quest.countDocuments()).toBe(3);
  });
  it("requires current terms and audits acceptance", async () => {
    await User.updateOne(
      { _id: users[0]._id },
      { $unset: { termsVersion: 1 } },
    );
    const a = await actor(0);
    expect((await a.post("/quests", data())).status).toBe(403);
    expect(
      (await a.post("/users/me/terms", { version: TERMS_VERSION })).status,
    ).toBe(200);
    expect(await TermsAcceptance.countDocuments({ userId: users[0]._id })).toBe(
      1,
    );
    expect((await a.post("/quests", data())).status).toBe(201);
  });
});
describe("quest lifecycle", () => {
  it("allows exactly one accepting student under concurrency", async () => {
    const q = await fixture();
    const b = await actor(1);
    const c = await actor(2);
    const results = await Promise.all([
      b.post(`/quests/${q._id}/accept`),
      c.post(`/quests/${q._id}/accept`),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await Quest.findById(q._id))!.status).toBe("ACCEPTED");
  });
  it("rejects self acceptance and acceptance at expiration before cleanup", async () => {
    const q = await fixture();
    const a = await actor(0);
    const b = await actor(1);
    expect((await a.post(`/quests/${q._id}/accept`)).status).toBe(409);
    await Quest.updateOne(
      { _id: q._id },
      { $set: { deadline: new Date(Date.now() - 1) } },
    );
    expect((await b.post(`/quests/${q._id}/accept`)).status).toBe(409);
    await expireQuests();
    expect((await Quest.findById(q._id))!.status).toBe("EXPIRED");
  });
  it("preserves overdue accepted quests", async () => {
    const q = await fixture({ performerId: users[1]._id, status: "ACCEPTED" });
    await Quest.updateOne(
      { _id: q._id },
      { $set: { deadline: new Date(Date.now() - 1) } },
    );
    await expireQuests();
    expect((await Quest.findById(q._id))!.status).toBe("ACCEPTED");
    expect(
      (await request(app).get(`/api/v1/quests/${q._id}`)).body.overdue,
    ).toBe(true);
  });
  it("enforces cancellation ownership and confirmation with history", async () => {
    const q = await fixture();
    const a = await actor(0);
    const b = await actor(1);
    expect((await b.post(`/quests/${q._id}/cancel`)).status).toBe(403);
    await b.post(`/quests/${q._id}/accept`);
    expect((await a.post(`/quests/${q._id}/cancel`)).status).toBe(400);
    const cancel = await a.post(`/quests/${q._id}/cancel`, { confirm: true });
    expect(cancel.status).toBe(200);
    expect(cancel.body.cancellationStage).toBe("AFTER_ACCEPTANCE");
    expect(cancel.body.canceledBy).toBe(String(users[0]._id));
    expect(cancel.body.performerId).toBe(String(users[1]._id));
    expect((await b.post(`/quests/${q._id}/accept`)).status).toBe(409);
  });
  it("requires performer submission then requester confirmation and rejects doubles", async () => {
    const q = await fixture({ status: "ACCEPTED", performerId: users[1]._id });
    const a = await actor(0);
    const b = await actor(1);
    expect((await a.post(`/quests/${q._id}/complete`)).status).toBe(409);
    expect((await a.post(`/quests/${q._id}/submit`)).status).toBe(403);
    expect((await b.post(`/quests/${q._id}/submit`)).status).toBe(200);
    expect((await b.post(`/quests/${q._id}/submit`)).status).toBe(409);
    expect((await b.post(`/quests/${q._id}/complete`)).status).toBe(403);
    expect((await a.post(`/quests/${q._id}/complete`)).status).toBe(200);
    expect((await a.post(`/quests/${q._id}/complete`)).status).toBe(409);
  });
  it("allows only moderators to resolve disputes", async () => {
    const q = await fixture({ status: "ACCEPTED", performerId: users[1]._id });
    const a = await actor(0);
    const admin = await actor(3);
    expect(
      (
        await a.post(`/quests/${q._id}/dispute`, {
          reason: "The work was not delivered.",
        })
      ).status,
    ).toBe(200);
    const report = await Report.findOne({ questId: q._id });
    expect(
      (
        await a.post(`/admin/reports/${report!._id}/resolve`, {
          status: "RESOLVED",
          resolution: "Reviewed evidence",
          questResolution: "COMPLETED",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await admin.post(`/admin/reports/${report!._id}/resolve`, {
          status: "RESOLVED",
          resolution: "Reviewed evidence",
          questResolution: "COMPLETED",
        })
      ).status,
    ).toBe(200);
    expect((await Quest.findById(q._id))!.status).toBe("COMPLETED");
  });
});
describe("reviews and messages", () => {
  it("enforces unique reviews, mutual review, and consistent aggregates under races", async () => {
    const q = await fixture({ status: "COMPLETED", performerId: users[1]._id });
    const a = await actor(0);
    const b = await actor(1);
    const results = await Promise.all([
      a.post(`/quests/${q._id}/reviews`, { rating: 4 }),
      a.post(`/quests/${q._id}/reviews`, { rating: 5 }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(
      (await b.post(`/quests/${q._id}/reviews`, { rating: 3 })).status,
    ).toBe(201);
    expect(await Review.countDocuments()).toBe(2);
    const user = await User.findById(users[1]._id);
    expect(user!.ratingCount).toBe(1);
    expect([4, 5]).toContain(user!.averageRating);
  });
  it("denies self/outsider/unfinished quest reviews", async () => {
    const q = await fixture({ status: "ACCEPTED", performerId: users[1]._id });
    const a = await actor(0);
    const c = await actor(2);
    expect(
      (await a.post(`/quests/${q._id}/reviews`, { rating: 5 })).status,
    ).toBe(409);
    expect(
      (await c.post(`/quests/${q._id}/reviews`, { rating: 5 })).status,
    ).toBe(403);
  });
  it("authorizes participant chat, persists chronology, and locks sending after closure", async () => {
    const q = await fixture();
    const a = await actor(0);
    const b = await actor(1);
    const c = await actor(2);
    expect((await a.get(`/quests/${q._id}/messages`)).status).toBe(403);
    await b.post(`/quests/${q._id}/accept`);
    expect((await c.get(`/quests/${q._id}/messages`)).status).toBe(403);
    expect(
      (await c.post(`/quests/${q._id}/messages`, { content: "intrusion" }))
        .status,
    ).toBe(403);
    await a.post(`/quests/${q._id}/messages`, { content: "Hello" });
    await b.post(`/quests/${q._id}/messages`, { content: "On my way" });
    expect(
      (await a.get(`/quests/${q._id}/messages`)).body.map(
        (m: any) => m.content,
      ),
    ).toEqual(["Hello", "On my way"]);
    await a.post(`/quests/${q._id}/cancel`, { confirm: true });
    expect((await b.get(`/quests/${q._id}/messages`)).status).toBe(200);
    expect(
      (await b.post(`/quests/${q._id}/messages`, { content: "closed" })).status,
    ).toBe(409);
    expect(await Message.countDocuments()).toBe(2);
  });
});
describe("security, reports, and moderation", () => {
  it("rejects missing authentication, bad development identities, CSRF, and foreign origins", async () => {
    const agent = request.agent(app);
    const token = (await agent.get("/api/v1/auth/me")).body.csrfToken;
    expect(
      (
        await agent
          .post("/api/v1/quests")
          .set("x-csrf-token", token)
          .send(data())
      ).status,
    ).toBe(401);
    expect(
      (
        await agent
          .post("/api/v1/auth/dev-login")
          .set("x-csrf-token", token)
          .send({ kerberosId: "not-seeded" })
      ).status,
    ).toBe(401);
    const a = await actor(0);
    expect((await a.agent.post("/api/v1/quests").send(data())).status).toBe(
      403,
    );
    expect(
      (await a.post("/quests", data()).set("Origin", "https://evil.example"))
        .status,
    ).toBe(403);
  });
  it("keeps profiles private and prevents privilege/rating edits", async () => {
    const a = await actor(0);
    expect(
      (
        await a.patch("/users/me", {
          role: "MODERATOR",
          averageRating: 5,
          strikeCount: 0,
        })
      ).status,
    ).toBe(400);
    const response = await request(app).get(`/api/v1/users/${users[0]._id}`);
    expect(response.body.email).toBeUndefined();
    expect(response.body.kerberosId).toBeUndefined();
    expect(response.body.strikeCount).toBeUndefined();
  });
  it("submits private reports and restricts moderation routes", async () => {
    const a = await actor(0);
    const b = await actor(1);
    const admin = await actor(3);
    expect(
      (
        await a.post("/reports", {
          reportedUserId: String(users[1]._id),
          reason: "Payment dispute",
          description: "Participant reported nonpayment.",
        })
      ).status,
    ).toBe(201);
    expect((await a.get("/users/me/reports")).body).toHaveLength(1);
    expect((await b.get("/users/me/reports")).body).toHaveLength(0);
    expect((await a.get("/admin/reports")).status).toBe(403);
    expect((await admin.get("/admin/reports")).body).toHaveLength(1);
  });
  it("issues reviewed strikes, suspends after three, and audits revocation", async () => {
    const a = await actor(0);
    const admin = await actor(3);
    const report = await Report.create({
      reporterId: users[0]._id,
      reportedUserId: users[1]._id,
      reason: "Scam",
      description: "Evidence reviewed",
      status: "UNDER_REVIEW",
    });
    const body = {
      relatedReportId: String(report._id),
      reason: "Reviewed and documented incident",
    };
    expect(
      (await a.post(`/admin/users/${users[1]._id}/strikes`, body)).status,
    ).toBe(403);
    for (let i = 0; i < 3; i++)
      expect(
        (await admin.post(`/admin/users/${users[1]._id}/strikes`, body)).status,
      ).toBe(201);
    expect((await User.findById(users[1]._id))!.accountStatus).toBe(
      "SUSPENDED",
    );
    const b = await actor(1);
    expect((await b.post("/quests", data())).status).toBe(403);
    const q = await fixture();
    expect((await b.post(`/quests/${q._id}/accept`)).status).toBe(403);
    const strike = await Strike.findOne();
    expect(
      (await admin.post(`/admin/strikes/${strike!._id}/revoke`)).status,
    ).toBe(200);
    expect((await User.findById(users[1]._id))!.accountStatus).toBe("ACTIVE");
    expect((await Strike.findById(strike!._id))!.revokedBy).toEqual(
      users[3]._id,
    );
  });
});
describe("discovery", () => {
  it("combines geospatial, payment, category filters and excludes expired results", async () => {
    await fixture();
    await fixture({ category: "FOOD", payCents: 900 });
    await fixture({
      payCents: 800,
      startLocation: {
        type: "Point",
        coordinates: [-72, 43],
        label: "Far away",
      },
    });
    await fixture({ payCents: 300 });
    const expired = await fixture();
    await Quest.updateOne(
      { _id: expired._id },
      { $set: { deadline: new Date(Date.now() - 1) } },
    );
    const response = await request(app).get(
      "/api/v1/quests?radiusMeters=1000&minPayCents=600&maxPayCents=1000&category=DELIVERY",
    );
    expect(response.status).toBe(200);
    expect(response.body.total).toBe(1);
    expect(response.body.items[0].payCents).toBe(700);
    expect(response.body.items[0].distanceMeters).toBeLessThan(10);
  });
  it("sorts, paginates and handles literal search characters", async () => {
    await fixture({ payCents: 500 });
    await fixture({ payCents: 1200, title: "Borrow (a) charger" });
    const response = await request(app).get(
      "/api/v1/quests?sort=payment&limit=1",
    );
    expect(response.body.total).toBe(2);
    expect(response.body.items[0].payCents).toBe(1200);
    expect(
      (await request(app).get("/api/v1/quests?search=%28a%29")).body.total,
    ).toBe(1);
    expect(
      (await request(app).get("/api/v1/quests?radiusMeters=10001")).status,
    ).toBe(400);
  });
});

describe("failure handling and real-time authorization", () => {
  it("returns an unavailable health status when MongoDB cannot respond", async () => {
    const spy = vi
      .spyOn(mongoose.connection.db!, "admin")
      .mockImplementationOnce(
        () =>
          ({
            ping: async () => {
              throw new Error("Database unreachable");
            },
          }) as any,
      );
    try {
      expect((await request(app).get("/api/v1/health")).status).toBe(503);
    } finally {
      spy.mockRestore();
    }
  });
  it("disables the development identity adapter when configured off", async () => {
    const previous = config.AUTH_MODE;
    config.AUTH_MODE = "disabled";
    try {
      const agent = request.agent(app);
      const token = (await agent.get("/api/v1/auth/me")).body.csrfToken;
      expect(
        (
          await agent
            .post("/api/v1/auth/dev-login")
            .set("x-csrf-token", token)
            .send({ kerberosId: users[0].kerberosId })
        ).status,
      ).toBe(503);
    } finally {
      config.AUTH_MODE = previous;
    }
  });
  it("rejects production configuration that enables development authentication", async () => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_MODE", "development");
    vi.stubEnv("CLIENT_ORIGIN", "https://sidequest.example");
    vi.stubEnv("SESSION_SECRET", "a".repeat(64));
    try {
      await expect(import("../src/config.js")).rejects.toThrow(
        "Production requires",
      );
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
  it("authenticates sockets, denies outsider rooms, and emits persisted messages", async () => {
    app = createApp({
      store: new session.MemoryStore(),
      emit: (room, event, payload) => realtime.to(room).emit(event, payload),
    });
    const server = createServer(app);
    const realtime = attachRealtime(server, app.locals.sessions);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const port = (server.address() as any).port;
    const url = `http://127.0.0.1:${port}`;
    const a = await actor(0);
    const c = await actor(2);
    const q = await fixture({ status: "ACCEPTED", performerId: users[1]._id });
    const clients: Socket[] = [];
    async function connect(who?: typeof a) {
      const socket = socketClient(url, {
        transports: ["websocket"],
        reconnection: false,
        auth: { csrfToken: who?.token },
        extraHeaders: {
          Origin: config.CLIENT_ORIGIN,
          ...(who ? { Cookie: who.cookie } : {}),
        },
      });
      clients.push(socket);
      await new Promise<void>((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("connect_error", reject);
      });
      return socket;
    }
    try {
      await expect(connect()).rejects.toThrow("Unauthorized");
      const requester = await connect(a);
      const outsider = await connect(c);
      expect(
        await requester.timeout(3000).emitWithAck("join", String(q._id)),
      ).toEqual({ ok: true });
      expect(
        await outsider.timeout(3000).emitWithAck("join", String(q._id)),
      ).toEqual({ error: "Forbidden" });
      const event = new Promise<any>((resolve) =>
        requester.once("message", resolve),
      );
      expect(
        (
          await a.post(`/quests/${q._id}/messages`, {
            content: "A real-time persisted message",
          })
        ).status,
      ).toBe(201);
      expect((await event).questId).toBe(String(q._id));
      expect(await Message.countDocuments({ questId: q._id })).toBe(1);
    } finally {
      clients.forEach((socket) => socket.disconnect());
      await new Promise<void>((resolve) => realtime.close(() => resolve()));
    }
  });
});
