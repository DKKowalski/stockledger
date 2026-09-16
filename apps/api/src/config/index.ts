export default () => ({
  app: {
    environment: process.env.NODE_ENV ?? 'development',
    port: Number(process.env.PORT ?? 3000),
    webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
  },
  auth: {
    jwtSecret: process.env.JWT_SECRET,
    accessTokenTtlSeconds: Number(process.env.JWT_ACCESS_TTL_SECONDS ?? 28_800),
  },
});
