import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// API は別プロセス（既定 :8080）。開発時は /api を転送する
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:8080' } },
});
