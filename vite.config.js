import { defineConfig } from 'vite';
import aitDevtools from '@apps-in-toss/devtools/unplugin';

export default defineConfig(({ command }) => ({
  plugins: [...(command === 'serve' ? [aitDevtools.vite()] : [])],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
}));
