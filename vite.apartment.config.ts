import { defineConfig } from 'vite';
export default defineConfig({base:'/CityManager/',cacheDir:'.test-output/vite-apartment',build:{target:'es2022',outDir:'.test-output/apartment-dist',rolldownOptions:{input:'tests/apartment-preview.html'}}});
