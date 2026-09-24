import * as z from 'zod';

const postgresUrl = z
  .string()
  .url()
  .regex(/^postgres(?:ql)?:\/\//, 'Must be a PostgreSQL connection URL');
const optionalSetting = (minimumLength: number) => z.preprocess(
  (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
  z.string().min(minimumLength).optional(),
);

export default z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: postgresUrl,
  DIRECT_DATABASE_URL: postgresUrl.optional(),
  JWT_SECRET: z.string().min(32),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(28_800),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(120).default(30),
  RESEND_API_KEY: optionalSetting(1),
  EMAIL_FROM: optionalSetting(3),
});
