import mongoose from "mongoose";
import { connectDatabase } from "./db.js";
import { config } from "./config.js";
import { User, Quest, models } from "./models.js";
export async function seed() {
  const names = [
    ["demo-alex", "Alex Chen"],
    ["demo-maya", "Maya Patel"],
    ["demo-jordan", "Jordan Brooks"],
  ];
  const users = [];
  for (const [kerberosId, displayName] of names) {
    const user = await User.findOneAndUpdate(
      { kerberosId },
      {
        $setOnInsert: {
          email: `${kerberosId}@example.invalid`,
          displayName,
          fictional: true,
          role: config.MODERATOR_KERBEROS_IDS.split(",").includes(kerberosId)
            ? "MODERATOR"
            : "STUDENT",
          venmoUsername: undefined,
        },
      },
      { upsert: true, new: true },
    );
    users.push(user);
  }
  if (
    await Quest.exists({
      fictional: true,
      status: { $in: ["OPEN", "ACCEPTED"] },
      deadline: { $gt: new Date() },
    })
  )
    return;
  const places = [
    [
      "Grab dinner from the Student Center",
      "FOOD",
      700,
      "Student Center · W20",
      -71.0957,
      42.359,
      "Could you pick up a veggie bowl and meet me outside W20? I will cover the food separately.",
    ],
    [
      "Bring a charger to Stata",
      "DELIVERY",
      1000,
      "Stata Center · Building 32",
      -71.0905,
      42.3617,
      "I left my USB-C charger with a friend. Pick it up at the entrance and bring it to Lobby 7.",
    ],
    [
      "Return a book to Hayden",
      "ERRAND",
      500,
      "Hayden Library · Building 14",
      -71.0894,
      42.3591,
      "Drop my library book in the return box. I can meet you at the library entrance.",
    ],
    [
      "A hand moving a small shelf",
      "MOVING",
      1800,
      "Simmons Hall · W79",
      -71.1015,
      42.357,
      "Help me carry a lightweight shelf between rooms. No stairs or heavy lifting.",
    ],
    [
      "Borrow a bike pump",
      "BORROWING",
      400,
      "Baker House · W7",
      -71.0962,
      42.3565,
      "Looking to borrow a bicycle pump for ten minutes. I will return it immediately.",
    ],
    [
      "Deliver a notebook across campus",
      "DELIVERY",
      800,
      "Lobby 7 · Building 7",
      -71.0932,
      42.3592,
      "Bring a notebook to the Stata entrance. Coordinate the handoff in chat.",
    ],
  ];
  for (const [i, p] of places.entries())
    await Quest.create({
      requesterId: users[i % 3]._id,
      performerId: i === 5 ? users[0]._id : null,
      title: p[0],
      category: p[1],
      payCents: p[2],
      startLocation: { type: "Point", coordinates: [p[4], p[5]], label: p[3] },
      description: p[6],
      deadline: new Date(Date.now() + (i + 2) * 3600000),
      status: i === 5 ? "ACCEPTED" : "OPEN",
      acceptedAt: i === 5 ? new Date() : undefined,
      fictional: true,
    });
  for (const user of users) {
    const recent = await Quest.find({
      requesterId: user._id,
      createdAt: { $gt: new Date(Date.now() - 86400000) },
    }).select("createdAt");
    await User.updateOne(
      { _id: user._id },
      { $set: { questCreationTimes: recent.map((q) => q.createdAt) } },
    );
  }
}
if (process.argv[1]?.endsWith("seed.ts")) {
  try {
    if (config.NODE_ENV !== "development")
      throw new Error("Seed/reset is development-only.");
    await connectDatabase();
    if (process.argv.includes("--reset")) {
      const dbName = mongoose.connection.name;
      if (dbName !== "sidequest" && !dbName.endsWith("_dev"))
        throw new Error("Reset is limited to sidequest or *_dev databases.");
      for (const model of models) await model.deleteMany({});
    }
    await seed();
    console.log(
      "Database connected, indexed, and seeded with fictional MIT-area quests.",
    );
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Database setup failed",
    );
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}
