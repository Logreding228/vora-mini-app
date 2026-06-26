import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import legacy from '@vitejs/plugin-legacy';

export default defineConfig({
  plugins: [
    react(),
    legacy({
      targets: ['ios >= 13'],
    }),
  ],
  base: process.env.VITE_BASE_PATH || './',
});
