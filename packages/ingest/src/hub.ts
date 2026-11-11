// The ingest hub: runs in the leader tab's worker only, next to PGlite.
// Tabs control it and receive its events over BroadcastChannels, so only one tab ever
// subscribes and writes.
import type { Db } from '@nodal/db'
import { Ingestor } from './ingestor'
import { MqttSource } from './mqtt'
import { ReplaySource } from './replay'
import type { IncomingMessage, IngestEvent, MessageSource, SourceConfig, SourceStatus } from './types'

export const CONTROL_CHANNEL = 'nodal-control'
export const EVENT_CHANNEL = 'nodal-events'

export type ControlMessage =
  | { type: 'start'; config: SourceConfig; /** keep in settings so a new leader resumes it */ persist?: boolean }
  | { type: 'stop' }
  | { type: 'status' }
  | { type: 'reset' }

export type HubEvent =
  | { type: 'status'; status: SourceStatus }
  | { type: 'ingested'; events: IngestEvent[] }

const BATCH_DELAY_MS = 200
const BATCH_MAX = 500
const HEARTBEAT_MS = 30_000
const PRUNE_MS = 3_600_000
/** Re-fetch this much before the last history fetch ended: messages are stored once, so overlap is free. */
const HISTORY_OVERLAP_MS = 15 * 60_000

/**
 * The history URL to fetch: the configured one (e.g. "/history.jsonl?hours=48") on a first visit, else
 * everything since the last successful fetch from that URL, so a browser closed for days still gets
 * every message the recorder kept. Not earlier than the browser's own retention.
 */
export function historyRequestUrl(url: string, last: { url: string; to: string } | undefined, now: Date, retentionDays: number): string {
  if (!last || last.url !== url) return url
  const floor = now.getTime() - retentionDays * 86_400_000
  const since = new Date(Math.max(Date.parse(last.to) - HISTORY_OVERLAP_MS, floor)).toISOString()
  return `${url}${url.includes('?') ? '&' : '?'}since=${encodeURIComponent(since)}`
}

export class IngestHub {
  private ingestor: Ingestor
  private source: MessageSource | null = null
  private status: SourceStatus = { source: null, state: 'idle', received: 0 }
  private queue: IncomingMessage[] = []
  private flushing: Promise<void> | null = null
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private intervalId: number | null = null
  private timers: ReturnType<typeof setInterval>[] = []
  private control = new BroadcastChannel(CONTROL_CHANNEL)
  private events = new BroadcastChannel(EVENT_CHANNEL)

  constructor(private readonly db: Db) {
    this.ingestor = new Ingestor(db)
  }

  async start(): Promise<void> {
    await this.ingestor.init()
    this.control.onmessage = (e: MessageEvent<ControlMessage>) => void this.onControl(e.data)
    this.timers.push(setInterval(() => void this.heartbeat(), HEARTBEAT_MS))
    this.timers.push(setInterval(() => void this.ingestor.prune(), PRUNE_MS))
    await this.ingestor.prune()

    const saved = await this.db.query<{ value: SourceConfig }>(`select value from nodal_setting where key = 'source'`)
    const config = saved.rows[0]?.value
    if (config?.kind === 'mqtt') await this.startSource(config)
    else this.publishStatus()
  }

  private async onControl(msg: ControlMessage) {
    try {
      switch (msg.type) {
        case 'start':
          await this.db.query("delete from nodal_setting where key = 'sourceStopped'")
          if (msg.persist) {
            await this.db.query(
              `insert into nodal_setting (key, value) values ('source', $1::jsonb)
               on conflict (key) do update set value = excluded.value`,
              [JSON.stringify(msg.config)],
            )
          }
          await this.startSource(msg.config)
          break
        case 'stop':
          await this.db.query(`delete from nodal_setting where key = 'source'`)
          // remembered so a deployment's auto-connect does not override the user's choice
          await this.db.query("insert into nodal_setting (key, value) values ('sourceStopped', 'true') on conflict (key) do nothing")
          await this.stopSource()
          this.setStatus({ source: null, state: 'idle', detail: undefined })
          break
        case 'reset':
          await this.stopSource()
          await this.db.query("delete from nodal_setting where key = 'historyFetched'")
          await this.db.exec(`truncate observation, data_message, conformance_issue, monitored_interval,
            parameter, observer_device, metadata_version, node`)
          this.ingestor = new Ingestor(this.db)
          await this.ingestor.init()
          await this.db.query(`select pg_notify('nodal_changed', 'reset')`)
          this.setStatus({ source: null, state: 'idle', received: 0, detail: 'database cleared' })
          break
        case 'status':
          this.publishStatus()
          break
      }
    } catch (e) {
      this.setStatus({ state: 'error', detail: e instanceof Error ? e.message : String(e) })
    }
  }

  private async startSource(config: SourceConfig) {
    await this.stopSource()
    this.status = { source: config.kind, state: 'idle', received: 0 }
    const onStatus = (s: Partial<SourceStatus>) => this.setStatus(s)
    const onMessage = (m: IncomingMessage) => this.enqueue(m)

    if (config.kind === 'mqtt') {
      // History first (the recorder's last hours, including retained metadata), then live: a new
      // browser then starts with recent history instead of empty charts. Overlapping messages are
      // stored once (message ids are hashes of topic + payload).
      if (config.mqtt.historyUrl) {
        try {
          const url = config.mqtt.historyUrl
          const last = (await this.db.query<{ value: { url: string; to: string } }>(`select value from nodal_setting where key = 'historyFetched'`)).rows[0]?.value
          const days = (await this.db.query<{ d: number }>(`select nodal_setting_num('retentionDays') as d`)).rows[0]?.d ?? 30
          const history = new ReplaySource({ url: historyRequestUrl(url, last, new Date(), Number(days)), mode: 'instant', shiftToNow: false })
          this.source = history
          await history.start(onMessage, (s) => onStatus(s.state === 'done' ? { state: 'replaying', detail: 'history loaded, connecting live' } : { ...s, detail: `history: ${s.detail ?? ''}` }))
          await this.flush()
          for (const i of history.monitored) {
            await this.db.query(`insert into monitored_interval (source, from_ts, to_ts) values ('recorder', $1, $2)`, [i.from, i.to])
          }
          // stored only once everything is written: a fetch that fails is retried from the same point
          await this.db.query(
            `insert into nodal_setting (key, value) values ('historyFetched', $1::jsonb)
             on conflict (key) do update set value = excluded.value`,
            [JSON.stringify({ url, to: history.recorded?.to ?? new Date().toISOString() })],
          )
        } catch (e) {
          // no history is not fatal: carry on live
          onStatus({ detail: `history unavailable (${e instanceof Error ? e.message : String(e)}); live only` })
        }
        if (this.source === null) return // stopped while loading history
      }
      const src = new MqttSource(config.mqtt)
      src.onConnect = (sessionPresent) => void this.openInterval('mqtt', sessionPresent)
      src.onDisconnect = () => void this.closeInterval()
      this.source = src
      await src.start(onMessage, onStatus)
    } else {
      const src = new ReplaySource(config.replay)
      this.source = src
      // "done" from the source means everything is queued, not written: hold it until it is on disk,
      // so a tab closed right after "done" loses nothing
      let done: Partial<SourceStatus> | null = null
      src
        .start(onMessage, (s) => (s.state === 'done' ? (done = s) : onStatus(s)))
        .then(async () => {
          await this.flush()
          for (const i of src.monitored) {
            await this.db.query(`insert into monitored_interval (source, from_ts, to_ts) values ('replay', $1, $2)`, [i.from, i.to])
          }
          if (done) this.setStatus(done)
        })
        .catch((e) => this.setStatus({ state: 'error', detail: String(e) }))
    }
  }

  private async stopSource() {
    const s = this.source
    this.source = null
    if (s) await s.stop()
    await this.flush()
    await this.closeInterval()
  }

  private enqueue(m: IncomingMessage) {
    this.queue.push(m)
    if (this.queue.length >= BATCH_MAX) void this.flush()
    else if (!this.flushTimer) this.flushTimer = setTimeout(() => void this.flush(), BATCH_DELAY_MS)
  }

  /** Write everything queued. Resolves only once the queue is empty and written, even if a flush was already running. */
  private async flush(): Promise<void> {
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = null
    while (this.flushing) await this.flushing
    if (this.queue.length === 0) return
    this.flushing = this.drain().finally(() => (this.flushing = null))
    await this.flushing
  }

  private async drain(): Promise<void> {
    try {
      while (this.queue.length > 0) {
        const batch = this.queue.splice(0, BATCH_MAX)
        const events = await this.ingestor.ingestBatch(batch)
        this.events.postMessage({ type: 'ingested', events } satisfies HubEvent)
      }
      if (this.intervalId !== null) await this.touchInterval()
    } catch (e) {
      this.setStatus({ state: 'error', detail: `ingest failed: ${e instanceof Error ? e.message : String(e)}` })
    }
  }

  // --- monitored intervals ---

  private async openInterval(source: string, sessionPresent: boolean) {
    // A resumed persistent session means the broker queued messages while we were away:
    // treat the gap as monitored by extending the last interval.
    if (sessionPresent) {
      const last = await this.db.query<{ id: number }>(`select id from monitored_interval where source = $1 order by to_ts desc limit 1`, [source])
      if (last.rows[0]) {
        this.intervalId = Number(last.rows[0].id)
        await this.touchInterval()
        return
      }
    }
    const now = new Date()
    const res = await this.db.query<{ id: number }>(
      `insert into monitored_interval (source, from_ts, to_ts) values ($1, $2, $2) returning id`,
      [source, now],
    )
    this.intervalId = Number(res.rows[0]!.id)
  }

  private async touchInterval() {
    if (this.intervalId === null) return
    await this.db.query(`update monitored_interval set to_ts = greatest(to_ts, $2) where id = $1`, [this.intervalId, new Date()])
  }

  private async closeInterval() {
    await this.touchInterval()
    this.intervalId = null
  }

  private async heartbeat() {
    if (this.status.state === 'connected') await this.touchInterval()
  }

  // --- status ---

  private setStatus(s: Partial<SourceStatus>) {
    this.status = { ...this.status, ...s }
    this.publishStatus()
  }

  private publishStatus() {
    this.events.postMessage({ type: 'status', status: this.status } satisfies HubEvent)
  }

  async close() {
    await this.stopSource()
    this.timers.forEach(clearInterval)
    this.control.close()
    this.events.close()
  }
}
