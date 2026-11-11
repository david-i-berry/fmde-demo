// ReplaySource: replays a capture file (the capture.jsonl format) through the real decode path.
import { decodeMessage, encodeMessage } from '@nodal/model'
import type { IncomingMessage, MessageSource, ReplayConfig, SourceStatus } from './types'

export interface CaptureHeader {
  type: 'capture'
  version: number
  description?: string
  scenarioEnd?: string
  /** the window a history recorder served (its messages are all those it received in it) */
  recorded?: { from: string; to: string }
  monitored?: { from: string; to: string }[]
}

export interface CaptureLine {
  t: string
  topic: string
  retain: boolean
  payload: string // base64
}

export interface Capture {
  header: CaptureHeader
  lines: CaptureLine[]
}

export function parseCapture(text: string): Capture {
  const rows = text.split('\n').filter((l) => l.trim().length > 0).map((l) => JSON.parse(l))
  const header: CaptureHeader = rows[0]?.type === 'capture' ? rows.shift() : { type: 'capture', version: 1 }
  return { header, lines: rows as CaptureLine[] }
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Shift every observation time in a data message (re-encodes; metadata is returned unchanged). */
export function shiftPayload(payload: Uint8Array, shiftMs: number): Uint8Array {
  if (shiftMs === 0) return payload
  let msg
  try {
    msg = decodeMessage(payload)
  } catch {
    return payload // undecodable messages replay as captured
  }
  if (!msg.data) return payload
  const shiftS = Math.round(shiftMs / 1000)
  for (const o of msg.data.observations ?? []) {
    if (o.time) o.time = { ...o.time, seconds: String(Number(o.time.seconds ?? 0) + shiftS) }
  }
  return encodeMessage({ data: msg.data })
}

/**
 * Time shift that moves a capture to the present, rounded down to whole minutes so the scenario
 * ends within the last minute and observation times stay on whole minutes.
 */
export function shiftFor(capture: Capture, mode: ReplayConfig['mode'], now = Date.now()): number {
  const STEP = 60_000
  const first = Date.parse(capture.lines[0]?.t ?? new Date(now).toISOString())
  const end = capture.header.scenarioEnd ? Date.parse(capture.header.scenarioEnd) : Date.parse(capture.lines.at(-1)?.t ?? '') || now
  const raw = mode === 'realtime' ? now - first : now - end
  return Math.floor(raw / STEP) * STEP
}

export class ReplaySource implements MessageSource {
  readonly name = 'replay'
  private stopped = false

  constructor(private readonly config: ReplayConfig) {}

  /** Intervals the capture says were monitored, shifted like the messages. Set after start(). */
  monitored: { from: string; to: string }[] = []
  /** The window the capture covers, when its header says (a recorder's history). Set after start(). */
  recorded: { from: string; to: string } | null = null

  async start(onMessage: (m: IncomingMessage) => void, onStatus: (s: Partial<SourceStatus>) => void): Promise<void> {
    this.stopped = false
    let text = this.config.text
    if (text === undefined) {
      const res = await fetch(this.config.url!)
      if (!res.ok) throw new Error(`${this.config.url}: HTTP ${res.status}`)
      text = await res.text()
    }
    const capture = parseCapture(text)
    const shift = this.config.shiftToNow === false ? 0 : shiftFor(capture, this.config.mode)
    const shifted = (iso: string) => new Date(Date.parse(iso) + shift).toISOString()
    this.recorded = capture.header.recorded ?? null
    this.monitored = (capture.header.monitored ?? []).map((i) => ({ from: shifted(i.from), to: shifted(i.to) }))
    onStatus({ state: 'replaying', detail: `${capture.lines.length} messages, ${this.config.mode}` })

    const wallStart = Date.now()
    const captureStart = Date.parse(capture.lines[0]?.t ?? '')
    const speed = this.config.mode === 'realtime' ? 1 : (this.config.speed ?? 3600)
    let received = 0

    for (const line of capture.lines) {
      if (this.stopped) return
      if (this.config.mode !== 'instant') {
        const due = wallStart + (Date.parse(line.t) - captureStart) / speed
        const wait = due - Date.now()
        if (wait > 0) await new Promise((r) => setTimeout(r, wait))
        if (this.stopped) return
      }
      onMessage({
        topic: line.topic,
        payload: shiftPayload(base64ToBytes(line.payload), shift),
        retain: line.retain,
        retainReliable: true, // captures record the flag as published
        receivedAt: shifted(line.t),
      })
      received++
      if (received % 50 === 0) onStatus({ received })
    }
    onStatus({ state: 'done', received })
  }

  async stop(): Promise<void> {
    this.stopped = true
  }
}
