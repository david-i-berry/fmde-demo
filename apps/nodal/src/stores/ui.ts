import type { IngestEvent, SourceStatus } from '@nodal/ingest'
import { defineStore } from 'pinia'
import { computed, ref, shallowRef, triggerRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { onHubEvent, sendControl } from '../db/client'

const PREFS_KEY = 'nodal.prefs'
const INSPECTOR_MAX = 1000

export const WINDOWS = {
  '1h': 3600,
  '6h': 6 * 3600,
  '24h': 24 * 3600,
  '48h': 48 * 3600,
  '7d': 7 * 86400,
} as const
export type WindowKey = keyof typeof WINDOWS

interface Prefs {
  utc: boolean
  theme: 'system' | 'light' | 'dark'
  /** nodes with metadata but no data yet (e.g. retained POC1 metadata) are hidden unless this is on */
  showNeverSeen: boolean
}
const DEFAULT_PREFS: Prefs = { utc: true, theme: 'system', showNeverSeen: false }

function loadPrefs(): Prefs {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

export const useUiStore = defineStore('ui', () => {
  const prefs = ref(loadPrefs())
  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs.value))
    } catch {
      // per-viewer convenience only
    }
  }

  // "now", ticking so ages and windows move without new data
  const now = ref(Date.now())
  setInterval(() => (now.value = Date.now()), 15_000)

  // ingest hub status and the live inspector stream
  const source = ref<SourceStatus>({ source: null, state: 'idle', received: 0 })
  const events = shallowRef<IngestEvent[]>([])
  const paused = ref(false)
  onHubEvent((e) => {
    if (e.type === 'status') source.value = e.status
    else if (!paused.value) {
      const next = events.value.concat(e.events)
      events.value = next.length > INSPECTOR_MAX ? next.slice(-INSPECTOR_MAX) : next
      triggerRef(events)
    }
  })
  sendControl({ type: 'status' })

  return { prefs, savePrefs, now, source, events, paused }
})

/** Time window from the URL (?window=24h), ending now. Global state, shareable by link. */
export function useTimeWindow() {
  const route = useRoute()
  const router = useRouter()
  const ui = useUiStore()
  const key = computed<WindowKey>(() => {
    const q = route.query.window
    return typeof q === 'string' && q in WINDOWS ? (q as WindowKey) : '24h'
  })
  const to = computed(() => new Date(ui.now))
  const from = computed(() => new Date(ui.now - WINDOWS[key.value] * 1000))
  function set(k: WindowKey) {
    void router.replace({ query: { ...route.query, window: k === '24h' ? undefined : k } })
  }
  return { key, from, to, set }
}
