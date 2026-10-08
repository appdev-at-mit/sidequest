import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import type { RequestHandler } from "express";
import { config } from "./config.js";
import { participant } from "./app.js";
import { Quest, User } from "./models.js";
export function attachRealtime(server: HttpServer, sessions: RequestHandler) {
  const io = new Server(server, {
    transports: ["websocket"],
    cors: { origin: config.CLIENT_ORIGIN, credentials: true },
    maxHttpBufferSize: 16384,
  });
  io.engine.use(sessions);
  io.use(async (socket, next) => {
    const req = socket.request as any;
    if (
      req.headers.origin !== config.CLIENT_ORIGIN ||
      !req.session.userId ||
      socket.handshake.auth.csrfToken !== req.session.csrf
    )
      return next(new Error("Unauthorized"));
    try {
      const user = await User.findById(req.session.userId);
      if (!user || user.accountStatus !== "ACTIVE")
        return next(new Error("Unauthorized"));
      next();
    } catch {
      next(new Error("Unavailable"));
    }
  });
  io.on("connection", (socket) => {
    let attempts = 0;
    const reset = setInterval(() => {
      attempts = 0;
    }, 60000);
    // Reload the session to stop subscriptions when login expires or is logged out.
    const expiry = setInterval(() => {
      const req = socket.request as any;
      req.session.reload((error: Error) => {
        if (error || !req.session.userId) socket.disconnect(true);
      });
    }, 30000);
    socket.on("join", async (id, ack) => {
      const reply = typeof ack === "function" ? ack : () => {};
      if (
        ++attempts > 30 ||
        typeof id !== "string" ||
        !/^[a-f\d]{24}$/i.test(id)
      )
        return reply({ error: "Invalid room" });
      try {
        const req = socket.request as any;
        const user = await User.findById(req.session.userId);
        const q = await Quest.findById(id);
        if (
          !user ||
          user.accountStatus !== "ACTIVE" ||
          !q?.performerId ||
          !participant(q, req.session.userId)
        )
          return reply({ error: "Forbidden" });
        for (const room of socket.rooms)
          if (room !== socket.id) await socket.leave(room);
        await socket.join(id);
        reply({ ok: true });
      } catch {
        reply({ error: "Unavailable" });
      }
    });
    socket.on("disconnect", () => {
      clearInterval(reset);
      clearInterval(expiry);
    });
  });
  return io;
}
