import { defineConfig } from 'vite';
export default defineConfig({
  base: '/CityManager/', cacheDir: '.test-output/vite-luxury-tower',
  build: { target: 'es2022', outDir: '.test-output/luxury-tower-dist',
    rolldownOptions: { input: 'tests/luxury-tower-preview.html' } },
});
