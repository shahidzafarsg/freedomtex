import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'src',
  base: './',
  plugins: [react()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'esnext',
    chunkSizeWarningLimit: 6000,
  },
  server: { port: 5183, strictPort: true },
});
