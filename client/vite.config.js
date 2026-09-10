import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Local dev: the client (5173) proxies /api to the Express server (5050)
    // so the frontend code can always call plain relative paths like
    // `/api/documents`, identical to how they resolve in production via the
    // Netlify redirect in netlify.toml. No env-var API base URL needed.
    proxy: {
      '/api': {
        target: 'http://localhost:5050',
        changeOrigin: true,
      },
    },
  },
})
