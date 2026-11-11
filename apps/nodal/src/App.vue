<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue'
import { useRegisterSW } from 'virtual:pwa-register/vue'
import { useDisplay, useTheme } from 'vuetify'
import { APP_NAME } from './brand'
import { useTimeWindow, useUiStore, WINDOWS, type WindowKey } from './stores/ui'

const ui = useUiStore()
const w = useTimeWindow()
const theme = useTheme()
const { mobile } = useDisplay()
const drawer = ref(!mobile.value)
const { needRefresh, updateServiceWorker } = useRegisterSW()

watchEffect(() => theme.change(ui.prefs.theme))

const sourceChip = computed(() => {
  const s = ui.source
  if (s.state === 'connected') return { color: 'success', icon: 'mdi-lan-connect', text: 'Live' }
  if (s.state === 'replaying') return { color: 'info', icon: 'mdi-play-circle-outline', text: 'Replaying' }
  if (s.state === 'connecting') return { color: 'warning', icon: 'mdi-lan-pending', text: 'Connecting' }
  if (s.state === 'error') return { color: 'error', icon: 'mdi-alert-circle-outline', text: 'Source error' }
  if (s.state === 'done') return { color: undefined, icon: 'mdi-check', text: 'Replay done' }
  return { color: undefined, icon: 'mdi-lan-disconnect', text: 'No source' }
})

const nav = [
  { title: 'Status board', icon: 'mdi-view-dashboard-outline', to: { name: 'status' } },
  { title: 'Topology', icon: 'mdi-graph-outline', to: { name: 'topology' } },
  { title: 'Map', icon: 'mdi-map-outline', to: { name: 'map' } },
  { title: 'Message inspector', icon: 'mdi-message-text-outline', to: { name: 'inspector' } },
  { title: 'Settings', icon: 'mdi-cog-outline', to: { name: 'settings' } },
]

function cycleTheme() {
  const order = ['system', 'light', 'dark'] as const
  ui.prefs.theme = order[(order.indexOf(ui.prefs.theme) + 1) % order.length]!
  ui.savePrefs()
}
</script>

<template>
  <v-app>
    <v-navigation-drawer v-model="drawer" :temporary="mobile">
      <v-list nav density="comfortable">
        <v-list-item v-for="n in nav" :key="n.title" :to="{ ...n.to, query: { window: $route.query.window } }" :prepend-icon="n.icon" :title="n.title" exact />
      </v-list>
    </v-navigation-drawer>

    <v-app-bar density="comfortable" flat border="b">
      <v-app-bar-nav-icon @click="drawer = !drawer" />
      <v-app-bar-title>{{ APP_NAME }}</v-app-bar-title>
      <template #append>
        <v-menu v-if="mobile">
          <template #activator="{ props: menu }">
            <v-btn v-bind="menu" variant="outlined" size="small" append-icon="mdi-menu-down" class="me-1" title="Time window">{{ w.key.value }}</v-btn>
          </template>
          <v-list density="compact">
            <v-list-item v-for="(_, k) in WINDOWS" :key="k" :active="k === w.key.value" :title="`Last ${k}`" @click="w.set(k)" />
          </v-list>
        </v-menu>
        <v-btn-toggle
          v-else
          :model-value="w.key.value"
          density="compact"
          variant="outlined"
          divided
          mandatory
          class="me-2"
          @update:model-value="(k: WindowKey) => w.set(k)"
        >
          <v-btn v-for="(_, k) in WINDOWS" :key="k" :value="k" size="small">{{ k }}</v-btn>
        </v-btn-toggle>
        <v-chip :color="sourceChip.color" :prepend-icon="sourceChip.icon" size="small" class="me-2 d-none d-sm-flex" :to="{ name: 'settings' }" :title="ui.source.detail">
          {{ sourceChip.text }}
        </v-chip>
        <v-btn icon size="small" :title="`Theme: ${ui.prefs.theme}`" @click="cycleTheme">
          <v-icon :icon="ui.prefs.theme === 'system' ? 'mdi-theme-light-dark' : ui.prefs.theme === 'light' ? 'mdi-white-balance-sunny' : 'mdi-weather-night'" />
        </v-btn>
      </template>
    </v-app-bar>

    <v-snackbar v-model="needRefresh" timeout="-1" location="bottom end">
      A new version is available.
      <template #actions>
        <v-btn variant="text" @click="updateServiceWorker(true)">Reload</v-btn>
        <v-btn variant="text" @click="needRefresh = false">Later</v-btn>
      </template>
    </v-snackbar>

    <v-main>
      <v-container fluid class="pa-4">
        <router-view />
      </v-container>
    </v-main>
  </v-app>
</template>
