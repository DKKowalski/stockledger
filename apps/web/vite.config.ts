import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const port = Number(env.VITE_DEV_PORT ?? 5173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('VITE_DEV_PORT must be a port number between 1 and 65535');
  }
  return { plugins: [react()], server: { port, strictPort: true } };
});
