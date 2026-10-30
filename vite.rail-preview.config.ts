import {defineConfig} from 'vite';
/** Separate artifact: normal production build has no rail preview entry point. */
export default defineConfig({base:'/CityManager/',cacheDir:'.test-output/vite-rail',build:{target:'es2022',outDir:'.test-output/rail-build',rollupOptions:{input:'rail-preview.html'}}});
