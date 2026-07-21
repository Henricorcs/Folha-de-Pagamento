import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Em dev, o frontend chama /api e o Vite faz proxy para a API (porta 3333).
// Em produção, o nginx do container faz o mesmo proxy.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY || 'http://localhost:3333',
        changeOrigin: true,
      },
    },
  },
});
