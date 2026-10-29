import {defineConfig} from 'vite';
export default defineConfig({base:'/',cacheDir:'.test-output/citizen-render-cache',build:{target:'es2022',outDir:'.test-output/citizen-render-dist',rollupOptions:{input:['tests/fixtures/citizen-render.html','tests/fixtures/citizen-city.html']}}});
