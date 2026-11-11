// Deployment configuration read at runtime from /config.json (written by the container from its
// environment, docker/nodal-config.sh), so one image serves any deployment. Absent in development.
import type { MqttSourceConfig } from '@nodal/ingest'
import { reactive } from 'vue'
import { getDb, onHubEvent, sendControl } from './db/client'

export interface RuntimeConfig {
  /** connect on first load, unless this browser already has a source configured */
  autoConnect?: boolean
  /** public deployments: no conformance chips, filters, tabs or issue lists (the checks still run) */
  hideConformance?: boolean
  /** false: standalone builds (GitHub Pages) offer no history recorder; live messages only */
  historyRecorder?: boolean
  mqtt?: Partial<MqttSourceConfig>
}

/** Deployment switches for the views; set from /config.json by loadFeatures() before the app mounts. */
export const features = reactive({ hideConformance: false, historyRecorder: true })

export async function loadFeatures(): Promise<void> {
  const cfg = await runtimeConfig()
  features.hideConformance = cfg?.hideConformance === true
  features.historyRecorder = cfg?.historyRecorder !== false
}

let cached: Promise<RuntimeConfig | null> | null = null

export function runtimeConfig(): Promise<RuntimeConfig | null> {
  cached ??= fetch(`${import.meta.env.BASE_URL}config.json`, { cache: 'no-store' })
    .then((r) => (r.ok && /json/.test(r.headers.get('content-type') ?? '') ? (r.json() as Promise<RuntimeConfig>) : null))
    .catch(() => null)
  return cached
}

/**
 * Demo deployments: connect to the configured broker (with history) on first load. A browser that
 * already has a saved source (or the user stopped it) keeps its own choice.
 */
export async function autoConnect(): Promise<void> {
  const cfg = await runtimeConfig()
  if (!cfg?.autoConnect || !cfg.mqtt?.url) return
  const db = await getDb()
  const saved = await db.query(`select 1 from nodal_setting where key in ('source', 'sourceStopped')`)
  if (saved.rows.length > 0) return
  // wait for the hub to announce itself, then start (persisted, so a new leader tab resumes it)
  const off = onHubEvent((e) => {
    if (e.type !== 'status') return
    off()
    if (e.status.source) return
    sendControl({
      type: 'start',
      persist: true,
      config: { kind: 'mqtt', mqtt: { url: cfg.mqtt!.url!, ...cfg.mqtt, persistentSessionSeconds: cfg.mqtt?.persistentSessionSeconds ?? 0 } },
    })
  })
  sendControl({ type: 'status' })
}
