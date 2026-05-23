import { z } from "zod";

const ConfigSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().optional(),
  WEB_BASE_URL: z.string().default("http://localhost:3000"),
  API_BASE_URL: z.string().default("http://localhost:4000"),
  EXPOSURE_API_KEY: z.string().optional(),
  EXPOSURE_SECRET_KEY: z.string().optional(),
  EXPOSURE_EVENT_ID: z.coerce.number().default(255539),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  PUSH_CONTACT_EMAIL: z.string().default("mailto:admin@example.com"),
  JWT_SECRET: z.string().optional(),
  ADMIN_SECRET: z.string().optional()
});

export const config = ConfigSchema.parse(process.env);

export function isDatabaseConfigured(): boolean {
  return Boolean(config.DATABASE_URL?.startsWith("postgresql://") || config.DATABASE_URL?.startsWith("postgres://"));
}

export function isExposureConfigured(): boolean {
  return Boolean(config.EXPOSURE_API_KEY && config.EXPOSURE_SECRET_KEY);
}
