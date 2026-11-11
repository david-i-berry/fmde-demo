import templateCompilerOptions from '@tresjs/core/template-compiler-options'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import vuetify from 'vite-plugin-vuetify'
import { APP_DESCRIPTION, APP_NAME, APP_SHORT_NAME } from './src/brand'

export default defineConfig({
  // NODAL_BASE=/fmde-demo/ for the GitHub Pages build (built by the fmde-demo repo); '/' everywhere else
  base: process.env.NODAL_BASE || '/',
  plugins: [
    // <title> follows the brand (src/brand.ts)
    { name: 'nodal-title', transformIndexHtml: (html) => html.replace(/<title>[^<]*<\/title>/, `<title>${APP_NAME}</title>`) },
    // TresJS: <Tres*> and <primitive> are three.js objects, not DOM elements
    vue({ ...templateCompilerOptions }),
    vuetify({ autoImport: true }),
    VitePWA({
      // prompt, not autoUpdate: never reload under the user (an in-memory database would be lost)
      registerType: 'prompt',
      includeAssets: ['icon.svg'],
      manifest: {
        name: APP_NAME,
        short_name: APP_SHORT_NAME,
        description: APP_DESCRIPTION,
        theme_color: '#1c5cab',
        background_color: '#0d0d0d',
        display: 'standalone',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        // app shell, including the PGlite WASM and data bundle
        globPatterns: ['**/*.{js,css,html,svg,wasm,data,woff2}'],
        maximumFileSizeToCacheInBytes: 30 * 1024 * 1024,
        navigateFallback: 'index.html',
      },
    }),
  ],
  // PGlite ships its own WASM; pre-bundling breaks its asset resolution
  optimizeDeps: {
    exclude: ['@electric-sql/pglite'],
    // pre-bundle lazily used deps so dev does not reload the page when a route first loads them
    include: ['echarts/core', 'echarts/charts', 'echarts/components', 'echarts/renderers', 'vue-echarts', 'protobufjs/light.js', 'mqtt', 'three', '@tresjs/core'],
  },
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
})
