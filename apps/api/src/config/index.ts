const companyIds = (value: string | undefined) => (value ?? '').split(',').map((id) => id.trim()).filter(Boolean);

export default () => ({
  app: {
    environment: process.env.NODE_ENV ?? 'development',
    port: Number(process.env.PORT ?? 3000),
    // Match WEB_ORIGIN to the web dev server's actual port for credentialed requests.
    webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
    demoCompanyId: process.env.DEMO_COMPANY_ID,
    // Company allowlists are read at API startup; restart after changing the local .env.
    saleCompletionCompanyIds: companyIds(process.env.SALE_COMPLETION_COMPANY_IDS),
    pricingPreviewCompanyIds: companyIds(process.env.PRICING_PREVIEW_COMPANY_IDS),
    // Prospective writers are independently gated and require per-item verified enrollment.
    exactCostingCompanyIds: companyIds(process.env.EXACT_COSTING_COMPANY_IDS),
    // Current-cost reviews only append evidence; they never change valuation.
    saleReturnsCompanyIds: companyIds(process.env.SALE_RETURNS_COMPANY_IDS),
    stockOperationsCompanyIds: companyIds(process.env.STOCK_OPERATIONS_COMPANY_IDS),
    costReadinessCompanyIds: companyIds(process.env.COST_READINESS_COMPANY_IDS),
  },
  auth: {
    jwtSecret: process.env.JWT_SECRET,
    accessTokenTtlSeconds: Number(process.env.JWT_ACCESS_TTL_SECONDS ?? 900),
    refreshTokenTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30),
    passwordResetTtlMinutes: Number(process.env.PASSWORD_RESET_TTL_MINUTES ?? 30),
    emailVerificationTtlHours: Number(process.env.EMAIL_VERIFICATION_TTL_HOURS ?? 24),
    invitationTtlHours: Number(process.env.INVITATION_TTL_HOURS ?? 72),
  },
  email: {
    resendApiKey: process.env.RESEND_API_KEY,
    from: process.env.EMAIL_FROM,
  },
  monitoring: {
    sentryDsn: process.env.SENTRY_DSN,
  },
});
