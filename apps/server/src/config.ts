import dotenv from "dotenv";
import { z } from "zod";
import path from "node:path";
dotenv.config({ path: path.resolve(process.cwd(), "../../.env"), quiet: true });
dotenv.config({ quiet: true });
const env = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    DATABASE_URL: z
      .string()
      .regex(/^mongodb(\+srv)?:\/\//)
      .default("mongodb://127.0.0.1:27017/sidequest?replicaSet=rs0"),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    CLIENT_ORIGIN: z.string().url().default("http://localhost:5173"),
    SESSION_SECRET: z
      .string()
      .min(32)
      .default("local-only-change-this-secret-before-deploying"),
    AUTH_MODE: z.enum(["development", "disabled"]).default("development"),
    MODERATOR_KERBEROS_IDS: z.string().default(""),
    STRIKE_THRESHOLD: z.coerce.number().int().min(1).default(3),
  })
  .parse(process.env);
if (
  env.NODE_ENV === "production" &&
  (env.AUTH_MODE !== "disabled" ||
    env.SESSION_SECRET === "local-only-change-this-secret-before-deploying" ||
    !env.CLIENT_ORIGIN.startsWith("https://"))
) {
  throw new Error(
    "Production requires AUTH_MODE=disabled until Touchstone is integrated, HTTPS, and a unique SESSION_SECRET.",
  );
}
export const config = env;
export const TERMS_VERSION = "2026-10-08-draft-1";
export const categories = [
  "FOOD",
  "DELIVERY",
  "MOVING",
  "BORROWING",
  "ERRAND",
] as const;
