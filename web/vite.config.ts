import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // En desarrollo, /api va al backend: mismo origen para el navegador (cookies sin CORS).
    proxy: { '/api': 'http://127.0.0.1:3000' },
  },
});
