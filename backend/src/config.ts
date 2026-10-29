import { z } from "zod";
const Env = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  MAINTENANCE_MODE: z
    .enum(["0", "1"])
    .default("0")
    .transform((v) => v === "1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: z.string().default("127.0.0.1"),
  APP_ORIGIN: z.url().default("http://127.0.0.1:5173"),
  SUPPORT_EMAIL: z.email().default("support@dailyloop.example"),
  DATABASE_URL: z.string().optional(),
  SUPABASE_URL: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.url().optional(),
  ),
  SUPABASE_PUBLISHABLE_KEY: z.string().optional(),
  SESSION_ENCRYPTION_KEY: z.string().optional(),
});
export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const config = Env.parse(env);
  if (
    config.NODE_ENV === "production" &&
    !config.APP_ORIGIN.startsWith("https://")
  )
    throw new Error("Production APP_ORIGIN must use HTTPS.");
  if (
    config.SESSION_ENCRYPTION_KEY &&
    Buffer.from(config.SESSION_ENCRYPTION_KEY, "base64").length !== 32
  )
    throw new Error("SESSION_ENCRYPTION_KEY must encode 32 random bytes.");
  if (
    config.NODE_ENV === "production" &&
    config.SUPABASE_URL &&
    !config.SUPABASE_URL.startsWith("https://")
  )
    throw new Error("Production Supabase must use HTTPS.");
  return config;
}
export type Config = ReturnType<typeof readConfig>;
export function missingConfig(c: Config) {
  return (
    [
      "DATABASE_URL",
      "SUPABASE_URL",
      "SUPABASE_PUBLISHABLE_KEY",
      "SESSION_ENCRYPTION_KEY",
    ] as const
  ).filter((k) => !c[k]);
}
