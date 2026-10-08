import { createServer } from "node:http";
import mongoose from "mongoose";
import { config } from "./config.js";
import { connectDatabase, expireQuests } from "./db.js";
import { createApp } from "./app.js";
import { attachRealtime } from "./realtime.js";
try {
  await connectDatabase();
  const app = createApp({
    emit: (room, event, data) => io.to(room).emit(event, data),
  });
  const server = createServer(app);
  const io = attachRealtime(server, app.locals.sessions);
  await expireQuests();
  const cleanup = setInterval(() => {
    expireQuests().catch(() => console.error("Expiration job failed"));
  }, 60000);
  server.listen(config.PORT, () =>
    console.log(`SideQuest API listening on port ${config.PORT}`),
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => {
      clearInterval(cleanup);
      io.close();
      server.close(() => {
        mongoose.disconnect().finally(() => process.exit(0));
      });
    });
} catch (error) {
  console.error(error instanceof Error ? error.message : "Startup failed");
  process.exitCode = 1;
}
