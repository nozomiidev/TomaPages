import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const root = import.meta.dirname;

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    open: '/talk.html',
  },
  preview: {
    host: '127.0.0.1',
  },
  build: {
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
        talk: resolve(root, 'talk.html'),
        guruguru: resolve(root, 'guruguru.html'),
      },
    },
  },
});
