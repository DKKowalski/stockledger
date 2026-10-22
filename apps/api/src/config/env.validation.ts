import * as z from 'zod';

const postgresUrl = z
  .string()
  .url()
  .regex(/^postgres(?:ql)?:\/\//, 'Must be a PostgreSQL connection URL');
const optionalSetting = (minimumLength: number) => z.preprocess(
  (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
  z.string().min(minimumLength).optional(),
);
const companyIdList = z.string().optional().refine(
  (value) => !value?.trim() || value.split(',').every((id) => z.string().uuid().safeParse(id.trim()).success),
  'Must be a comma-separated list of company UUIDs',
);

export default z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: postgresUrl,
  DIRECT_DATABASE_URL: postgresUrl.optional(),
  JWT_SECRET: z.string().min(32),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(300).max(3_600).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(120).default(30),
  EMAIL_VERIFICATION_TTL_HOURS: z.coerce.number().int().min(1).max(72).default(24),
  INVITATION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(72),
  DEMO_COMPANY_ID: z.string().uuid().optional(),
  SALE_COMPLETION_COMPANY_IDS: companyIdList,
  PRICING_PREVIEW_COMPANY_IDS: companyIdList,
  COST_READINESS_COMPANY_IDS: companyIdList,
  EXACT_COSTING_COMPANY_IDS: companyIdList,
  SALE_RETURNS_COMPANY_IDS: companyIdList,
  STOCK_OPERATIONS_COMPANY_IDS: companyIdList,
  SENTRY_DSN: optionalSetting(1),
  RESEND_API_KEY: optionalSetting(1),
  EMAIL_FROM: optionalSetting(3),
});
