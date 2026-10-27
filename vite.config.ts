import { defineConfig } from 'vite';
export default defineConfig({ base: process.env.VITE_BASE_PATH || '/CityManager/', cacheDir: '.test-output/vite', build: { target: 'es2022' } });
