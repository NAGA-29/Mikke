import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// API は別プロセス（既定 :8080、MIKKE_API_URL で変更可）。開発時は /api を転送する
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': process.env.MIKKE_API_URL ?? 'http://localhost:8080' } },
});
