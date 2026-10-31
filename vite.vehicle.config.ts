import { defineConfig } from 'vite';
export default defineConfig({base:'/CityManager/',cacheDir:'.test-output/vite-vehicle',build:{target:'es2022',outDir:'.test-output/vehicle-dist',rolldownOptions:{input:'tests/vehicle-preview.html'}}});
