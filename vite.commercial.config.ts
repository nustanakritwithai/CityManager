import {defineConfig} from 'vite';
export default defineConfig({base:'/CityManager/',cacheDir:'.test-output/vite-commercial',build:{target:'es2022',outDir:'.test-output/commercial-dist',rolldownOptions:{input:'tests/commercial-preview.html'}}});
