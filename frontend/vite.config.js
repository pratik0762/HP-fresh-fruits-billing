import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The dev server proxies /api → backend so the app can be opened from ANY
// device on the network with one URL (http://<PC-IP>:5173). Devices never
// need to reach the backend port directly.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true, // listen on all interfaces (LAN access from phones/other PCs)
    allowedHosts: true, // permit tunnel hosts (loca.lt etc.) for remote testing
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true
      }
    }
  }
});
