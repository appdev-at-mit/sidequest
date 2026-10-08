import mongoose from "mongoose";
import { config } from "./config.js";
import { models } from "./models.js";
export async function connectDatabase(uri = config.DATABASE_URL) {
  mongoose.set("strictQuery", true);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
  if (!hello.setName && hello.msg !== "isdbgrid")
    throw new Error(
      "MongoDB must be a replica set (transactions are required).",
    );
  for (const model of models) await model.createIndexes();
}
export async function expireQuests() {
  await models[1].updateMany(
    { status: "OPEN", deadline: { $lte: new Date() } },
    { $set: { status: "EXPIRED" } },
  );
}
