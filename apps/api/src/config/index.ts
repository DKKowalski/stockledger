export default () => ({
  app: {
    environment: process.env.NODE_ENV ?? 'development',
    port: Number(process.env.PORT ?? 3000),
    webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
  },
  auth: {
    jwtSecret: process.env.JWT_SECRET,
    accessTokenTtlSeconds: Number(process.env.JWT_ACCESS_TTL_SECONDS ?? 28_800),
    passwordResetTtlMinutes: Number(process.env.PASSWORD_RESET_TTL_MINUTES ?? 30),
  },
  email: {
    resendApiKey: process.env.RESEND_API_KEY,
    from: process.env.EMAIL_FROM,
  },
});
