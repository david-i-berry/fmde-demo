<script setup lang="ts">
import { formatTime } from '@nodal/components'
import type { MqttSourceConfig, ReplayMode } from '@nodal/ingest'
import { DEFAULT_TOPIC_FILTERS } from '@nodal/ingest'
import { onMounted, ref } from 'vue'
import { currentVfs, getDb, opfsAhpSupported, sendControl, setVfs, type Vfs } from '../db/client'
import { features, runtimeConfig } from '../runtime-config'
import { useUiStore } from '../stores/ui'

const ui = useUiStore()

// --- source: MQTT ---
const CLIENT_ID_KEY = 'nodal.clientId'
// crypto.randomUUID is secure-context only (missing on http://<pc>:8080 from another device)
const shortId = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, '0')).join('')
function stableClientId(): string {
  try {
    let id = localStorage.getItem(CLIENT_ID_KEY)
    if (!id) {
      id = `nodal-${shortId()}`
      localStorage.setItem(CLIENT_ID_KEY, id)
    }
    return id
  } catch {
    return `nodal-${shortId()}`
  }
}
const mqtt = ref<MqttSourceConfig>({ url: '', username: '', password: '', topic: DEFAULT_TOPIC_FILTERS, clientId: stableClientId(), persistentSessionSeconds: 86400 })
const persistent = ref(true)

// --- source: replay ---
const replayMode = ref<ReplayMode>('instant')
const replaySpeed = ref(3600)
const shiftToNow = ref(true)
const captureFile = ref<File | null>(null)

// --- thresholds and storage ---
const settings = ref<Record<string, number>>({})
const vfs = ref<Vfs>(currentVfs())
const activeVfs = currentVfs()
const usage = ref<{ usage?: number; quota?: number; persisted?: boolean }>({})
const busy = ref(false)
const message = ref<string | null>(null)

onMounted(async () => {
  // a deployment's broker settings (config.json) as the starting point; a saved source wins
  const cfg = await runtimeConfig()
  if (cfg?.mqtt) mqtt.value = { ...mqtt.value, ...cfg.mqtt }
  const db = await getDb()
  const res = await db.query<{ key: string; value: unknown }>(`select key, value from nodal_setting`)
  for (const r of res.rows) {
    if (typeof r.value === 'number') settings.value[r.key] = r.value
    if (r.key === 'source' && (r.value as { kind: string }).kind === 'mqtt') {
      mqtt.value = { ...mqtt.value, ...(r.value as { mqtt: MqttSourceConfig }).mqtt }
    }
  }
  await refreshUsage()
})

async function refreshUsage() {
  if (!navigator.storage) return
  const est = await navigator.storage.estimate()
  usage.value = { usage: est.usage, quota: est.quota, persisted: await navigator.storage.persisted?.() }
}

async function requestPersist() {
  const ok = await navigator.storage?.persist?.()
  message.value = ok ? 'Storage is persistent: the browser will not evict it under pressure.' : 'The browser declined persistent storage.'
  await refreshUsage()
}

function connect() {
  // without a recorder (standalone builds) a history URL saved earlier is dropped too
  const { historyUrl, ...rest } = mqtt.value
  sendControl({
    type: 'start',
    persist: true,
    config: {
      kind: 'mqtt',
      mqtt: { ...rest, ...(features.historyRecorder && historyUrl ? { historyUrl } : {}), persistentSessionSeconds: persistent.value ? mqtt.value.persistentSessionSeconds : 0 },
    },
  })
}

async function replay() {
  if (!captureFile.value) return
  const text = await captureFile.value.text()
  sendControl({
    type: 'start',
    config: { kind: 'replay', replay: { text, mode: replayMode.value, speed: replaySpeed.value, shiftToNow: shiftToNow.value } },
  })
}

async function saveSetting(key: string) {
  const db = await getDb()
  await db.query(`update nodal_setting set value = $2::jsonb where key = $1`, [key, JSON.stringify(Number(settings.value[key]))])
  message.value = `Saved ${key}.`
}

async function backup() {
  busy.value = true
  try {
    const db = await getDb()
    const blob = await db.dumpDataDir('gzip')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `nodal-${new Date().toISOString().slice(0, 10)}.tar.gz`
    a.click()
    URL.revokeObjectURL(a.href)
  } finally {
    busy.value = false
  }
}

function reset() {
  if (confirm('Delete all nodes, metadata, observations and messages from this browser? This cannot be undone.')) sendControl({ type: 'reset' })
}

function switchVfs() {
  setVfs(vfs.value)
  location.reload()
}

const mb = (n?: number) => (n === undefined ? '—' : `${(n / 1024 / 1024).toFixed(1)} MB`)
</script>

<template>
  <v-snackbar :model-value="!!message" timeout="4000" @update:model-value="message = null">{{ message }}</v-snackbar>

  <v-row>
    <v-col cols="12" lg="6">
      <v-card variant="outlined" class="mb-4">
        <v-card-title>Source status</v-card-title>
        <v-card-text>
          <div><b>{{ ui.source.source ?? 'none' }}</b> · {{ ui.source.state }} · {{ ui.source.received }} message(s)</div>
          <div v-if="ui.source.detail" class="text-medium-emphasis">{{ ui.source.detail }}</div>
          <div v-if="ui.source.lastMessageAt" class="text-medium-emphasis">last message {{ formatTime(ui.source.lastMessageAt, ui.prefs.utc) }}</div>
        </v-card-text>
        <v-card-actions>
          <v-btn variant="tonal" prepend-icon="mdi-stop" :disabled="!ui.source.source" @click="sendControl({ type: 'stop' })">Stop source</v-btn>
        </v-card-actions>
      </v-card>

      <v-card variant="outlined" class="mb-4">
        <v-card-title>MQTT broker</v-card-title>
        <v-card-subtitle>MQTT 5 over WebSockets (wss://). Use read-only credentials limited to subscribing on {{ DEFAULT_TOPIC_FILTERS }} (the FMDE hierarchy and the legacy POC1 one).</v-card-subtitle>
        <v-card-text>
          <v-text-field v-model="mqtt.url" label="Broker URL" placeholder="wss://broker.example.org:8884/mqtt" density="compact" />
          <v-row dense>
            <v-col cols="12" sm="6"><v-text-field v-model="mqtt.username" label="Username" density="compact" autocomplete="username" /></v-col>
            <v-col cols="12" sm="6"><v-text-field v-model="mqtt.password" label="Password or token" type="password" density="compact" autocomplete="current-password" /></v-col>
          </v-row>
          <v-text-field v-model="mqtt.topic" label="Topic filters (comma-separated)" density="compact" />
          <v-text-field
            v-if="features.historyRecorder"
            v-model="mqtt.historyUrl"
            label="History recorder URL (optional)"
            placeholder="http://localhost:8090/history.jsonl?hours=48"
            hint="Replays the recorder's last hours, including retained metadata, before going live"
            persistent-hint
            density="compact"
            class="mb-2"
          />
          <v-switch v-model="persistent" label="Persistent session (broker queues QoS 1 messages while no tab is open)" color="primary" density="compact" hide-details />
          <v-text-field v-model="mqtt.clientId" label="Client ID (stable, so the session can resume)" density="compact" class="mt-2" />
          <v-alert type="info" variant="tonal" density="compact" class="mt-2">
            The connection settings, including the password, are stored in this browser's database so that a new leader tab can reconnect.
          </v-alert>
        </v-card-text>
        <v-card-actions>
          <v-btn color="primary" variant="flat" prepend-icon="mdi-lan-connect" :disabled="!mqtt.url.startsWith('ws')" @click="connect">Connect</v-btn>
        </v-card-actions>
      </v-card>

      <v-card variant="outlined">
        <v-card-title>Replay a capture</v-card-title>
        <v-card-subtitle>A recorded capture.jsonl, through the real decode path.</v-card-subtitle>
        <v-card-text>
          <v-file-input v-model="captureFile" label="Capture file" accept=".jsonl" density="compact" prepend-icon="mdi-file-upload-outline" clearable />
          <v-radio-group v-model="replayMode" inline density="compact" hide-details>
            <v-radio label="All at once" value="instant" />
            <v-radio label="Accelerated" value="accelerated" />
            <v-radio label="Original timing" value="realtime" />
          </v-radio-group>
          <v-text-field v-if="replayMode === 'accelerated'" v-model.number="replaySpeed" type="number" label="Speed (capture seconds per second)" density="compact" class="mt-2" />
          <v-switch v-model="shiftToNow" label="Shift times so the capture ends now" color="primary" density="compact" hide-details />
        </v-card-text>
        <v-card-actions>
          <v-btn color="primary" variant="flat" prepend-icon="mdi-play" :disabled="!captureFile" @click="replay">Replay</v-btn>
        </v-card-actions>
      </v-card>
    </v-col>

    <v-col cols="12" lg="6">
      <v-card variant="outlined" class="mb-4">
        <v-card-title>Node state thresholds</v-card-title>
        <v-card-subtitle>Global defaults; a node's hub configuration can override them. Expected reporting frequency is not modelled yet.</v-card-subtitle>
        <v-card-text>
          <v-text-field v-for="k in ['lateAfterSeconds', 'silentAfterSeconds', 'retentionDays', 'futureToleranceSeconds']" :key="k" v-model.number="settings[k]" :label="k" type="number" density="compact">
            <template #append><v-btn size="small" variant="tonal" @click="saveSetting(k)">Save</v-btn></template>
          </v-text-field>
        </v-card-text>
      </v-card>

      <v-card variant="outlined" class="mb-4">
        <v-card-title>Display</v-card-title>
        <v-card-text>
          <v-switch v-model="ui.prefs.utc" label="Show times in UTC" color="primary" density="compact" hide-details @update:model-value="ui.savePrefs()" />
        </v-card-text>
      </v-card>

      <v-card variant="outlined">
        <v-card-title>Storage</v-card-title>
        <v-card-text>
          <div>In use: <b>{{ activeVfs }}</b> · {{ mb(usage.usage) }} of {{ mb(usage.quota) }} · {{ usage.persisted ? 'persistent' : 'may be evicted' }}</div>
          <v-radio-group v-model="vfs" density="compact" hide-details class="mt-2">
            <v-radio label="IndexedDB (default, all browsers)" value="idb" />
            <v-radio label="OPFS access handle pool (faster; Chromium and Firefox)" value="opfs-ahp" :disabled="!opfsAhpSupported()" />
            <v-radio label="In memory (lost on reload)" value="memory" />
          </v-radio-group>
          <div class="text-caption text-medium-emphasis">Each storage option is a separate database. Switching reloads the app.</div>
        </v-card-text>
        <v-card-actions class="flex-wrap">
          <v-btn variant="tonal" :disabled="vfs === activeVfs" @click="switchVfs">Switch</v-btn>
          <v-btn variant="tonal" :disabled="usage.persisted" @click="requestPersist">Request persistence</v-btn>
          <v-btn variant="tonal" prepend-icon="mdi-download" :loading="busy" @click="backup">Backup</v-btn>
          <v-btn variant="text" color="error" prepend-icon="mdi-delete-outline" @click="reset">Clear data</v-btn>
        </v-card-actions>
      </v-card>
    </v-col>
  </v-row>
</template>
