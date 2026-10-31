import { defineConfig } from 'vite';
export default defineConfig({base:'/CityManager/',cacheDir:'.test-output/vite-farm',build:{target:'es2022',outDir:'.test-output/farm-dist',rolldownOptions:{input:'tests/farm-preview.html'}}});
