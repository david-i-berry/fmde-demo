import type { ConformanceIssue, NodeKey } from '@nodal/model'

/** One message as received from a broker or replayed from a capture. */
export interface IncomingMessage {
  topic: string
  payload: Uint8Array
  /** MQTT retain flag as delivered. */
  retain: boolean
  /**
   * Whether `retain === false` can be trusted. Brokers clear the flag on live delivery unless
   * the subscription uses MQTT 5 Retain As Published; captures record it as published.
   */
  retainReliable: boolean
  receivedAt: string
}

/** Summary of one ingested message, broadcast to every tab for the message inspector. */
export interface IngestEvent {
  receivedAt: string
  topic: string
  nodeKey: NodeKey | null
  kind: 'metadata' | 'data' | 'cleared' | 'unknown'
  /** topic hierarchy: firstmile/a, or the legacy POC1 */
  profile?: 'a' | 'poc1'
  messageId: string | null
  payloadBytes: number
  retain: boolean
  /** Data: observation count. Metadata: version (new or unchanged). */
  observations?: number
  metadataVersion?: number | null
  newMetadataVersion?: boolean
  duplicate?: boolean
  issues: ConformanceIssue[]
}

export type SourceState = 'idle' | 'connecting' | 'connected' | 'replaying' | 'done' | 'error' | 'closed'

export interface SourceStatus {
  source: 'mqtt' | 'replay' | null
  state: SourceState
  detail?: string
  received: number
  lastMessageAt?: string
}

/** A message source: MQTT or replay. The rest of the app cannot tell which it is using. */
export interface MessageSource {
  readonly name: 'mqtt' | 'replay'
  start(onMessage: (m: IncomingMessage) => void, onStatus: (s: Partial<SourceStatus>) => void): Promise<void>
  stop(): Promise<void>
}

export interface MqttSourceConfig {
  /** wss://host:port/path */
  url: string
  username?: string
  password?: string
  /** Stable client id: required for a persistent session to resume after reconnect. */
  clientId?: string
  /** Topic filter(s), comma-separated; defaults to firstmile/a/# and firstmile/poc1/# */
  topic?: string
  /** MQTT 5 with a session expiry so QoS 1 messages queue while no tab is open. */
  persistentSessionSeconds?: number
  /** History recorder endpoint (e.g. /history.jsonl or https://…/history.jsonl?hours=48), replayed before going live */
  historyUrl?: string
}

export type ReplayMode = 'instant' | 'accelerated' | 'realtime'

export interface ReplayConfig {
  /** URL of a capture.jsonl, or its text. */
  url?: string
  text?: string
  mode: ReplayMode
  /** accelerated only: capture seconds per wall-clock second. */
  speed?: number
  /** Shift capture times so the scenario ends now (instant/accelerated) or starts now (realtime). */
  shiftToNow?: boolean
}

export type SourceConfig = { kind: 'mqtt'; mqtt: MqttSourceConfig } | { kind: 'replay'; replay: ReplayConfig }
