import { defineConfig } from 'vite';
export default defineConfig({base:'/CityManager/',cacheDir:'.test-output/vite-factory',build:{target:'es2022',outDir:'.test-output/factory-dist',rolldownOptions:{input:'tests/factory-preview.html'}}});
