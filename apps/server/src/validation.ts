import { z } from "zod";
import { categories } from "./config.js";
export const idSchema = z
  .string()
  .regex(/^[a-f\d]{24}$/i, "Invalid identifier");
export const pointSchema = z
  .object({
    type: z.literal("Point"),
    coordinates: z.tuple([
      z.number().min(-180).max(180),
      z.number().min(-90).max(90),
    ]),
    label: z.string().trim().min(1).max(120),
  })
  .strict();
export const createQuestSchema = z
  .object({
    title: z.string().trim().min(1).max(100),
    description: z.string().trim().min(1).max(2000),
    instructions: z.string().trim().max(1000).optional(),
    payCents: z.number().int().positive().max(100000),
    category: z.enum(categories),
    startLocation: pointSchema,
    endLocation: pointSchema.optional(),
    deadline: z.coerce
      .date()
      .refine(
        (v) => v > new Date() && v.getTime() <= Date.now() + 86400000,
        "Deadline must be in the future and within 24 hours",
      ),
  })
  .strict();
export const searchSchema = z
  .object({
    latitude: z.coerce.number().min(-90).max(90).default(42.3592),
    longitude: z.coerce.number().min(-180).max(180).default(-71.0932),
    radiusMeters: z.coerce.number().min(100).max(10000).default(2000),
    minPayCents: z.coerce.number().int().min(0).default(0),
    maxPayCents: z.coerce.number().int().max(100000).default(100000),
    category: z.enum(categories).optional(),
    sort: z
      .enum(["distance", "payment", "newest", "deadline"])
      .default("distance"),
    search: z.string().trim().max(100).optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict()
  .refine(
    (v) => v.minPayCents <= v.maxPayCents,
    "Minimum payment exceeds maximum",
  );
