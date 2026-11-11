import '@mdi/font/css/materialdesignicons.css'
import 'vuetify/styles'
import { createPinia } from 'pinia'
import { createApp } from 'vue'
import { createVuetify } from 'vuetify'
import App from './App.vue'
import { getDb } from './db/client'
import { autoConnect, loadFeatures } from './runtime-config'
import { router } from './router'

const vuetify = createVuetify({
  theme: {
    defaultTheme: 'system',
    themes: {
      light: { colors: { primary: '#1c5cab', background: '#f9f9f7', surface: '#fcfcfb' } },
      dark: { colors: { primary: '#86b6ef', background: '#0d0d0d', surface: '#1a1a19' } },
    },
  },
  defaults: { VCard: { rounded: 'lg' } },
})

// Start the worker early: tabs elect a leader, which opens PGlite and resumes ingest.
void getDb()
// deployments (config.json): connect to the configured broker, with history, on first load
void autoConnect()

// deployment switches first, so a public view never flashes the conformance UI
void loadFeatures().finally(() => createApp(App).use(createPinia()).use(router).use(vuetify).mount('#app'))
