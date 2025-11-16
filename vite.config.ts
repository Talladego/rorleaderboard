import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3002
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      input: {
        index: new URL('./index.html', import.meta.url).pathname
      }
    }
  },
  base: '/'
});
