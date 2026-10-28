import { defineConfig } from 'vite';
export default defineConfig({
  base: '/CityManager/', cacheDir: '.test-output/park-vite',
  server: { watch: { ignored: ['**/.test-output/**', '**/dist-park-activity/**'] } },
  build: { target: 'es2022', outDir: 'dist-park-activity', rollupOptions: { input: 'park-activity-preview.html' } },
});
