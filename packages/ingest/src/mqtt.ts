// MqttSource: mqtt.js over WSS with read-only credentials, subscribing to firstmile/a/# and the legacy
// firstmile/poc1/#.
import mqtt, { type IClientOptions, type MqttClient } from 'mqtt'
import { POC1_TOPIC_FILTER, TOPIC_FILTER } from '@nodal/model'
import type { IncomingMessage, MessageSource, MqttSourceConfig, SourceStatus } from './types'

/** Default: the FMDE hierarchy and the legacy POC1 one the test devices still use. */
export const DEFAULT_TOPIC_FILTERS = `${TOPIC_FILTER}, ${POC1_TOPIC_FILTER}`

export class MqttSource implements MessageSource {
  readonly name = 'mqtt'
  private client: MqttClient | null = null

  constructor(private readonly config: MqttSourceConfig) {}

  /** Called on every (re)connect: sessionPresent = the broker kept our session, so queued messages follow. */
  onConnect: ((sessionPresent: boolean) => void) | null = null
  onDisconnect: (() => void) | null = null

  async start(onMessage: (m: IncomingMessage) => void, onStatus: (s: Partial<SourceStatus>) => void): Promise<void> {
    const persistent = (this.config.persistentSessionSeconds ?? 0) > 0
    const options: IClientOptions = {
      protocolVersion: 5,
      clientId: this.config.clientId || `nodal-${Math.random().toString(16).slice(2, 10)}`,
      username: this.config.username || undefined,
      password: this.config.password || undefined,
      clean: !persistent,
      properties: persistent ? { sessionExpiryInterval: this.config.persistentSessionSeconds } : undefined,
      reconnectPeriod: 5000,
      connectTimeout: 15_000,
    }
    // comma-separated filters
    const topic = this.config.topic || DEFAULT_TOPIC_FILTERS
    const filters = topic.split(',').map((t) => t.trim()).filter(Boolean)
    onStatus({ state: 'connecting', detail: this.config.url })
    const client = mqtt.connect(this.config.url, options)
    this.client = client
    let received = 0

    client.on('connect', (connack) => {
      onStatus({ state: 'connected', detail: `${this.config.url} (${topic})` })
      this.onConnect?.(connack.sessionPresent)
      // Retain As Published: the broker keeps the publisher's retain flag on live delivery, so
      // METADATA_NOT_RETAINED can be checked. QoS 1 so a persistent session queues messages.
      client.subscribe(Object.fromEntries(filters.map((t) => [t, { qos: 1 as const, rap: true }])), (err, granted) => {
        if (err) onStatus({ state: 'error', detail: `subscribe failed: ${err.message}` })
        else if (granted?.some((g) => g.qos >= 128)) onStatus({ state: 'error', detail: `subscription to ${topic} refused (check the ACL)` })
      })
    })
    client.on('message', (msgTopic, payload, packet) => {
      received++
      const receivedAt = new Date().toISOString()
      onMessage({
        topic: msgTopic,
        payload: new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength).slice(),
        retain: packet.retain,
        retainReliable: true,
        receivedAt,
      })
      onStatus({ received, lastMessageAt: receivedAt })
    })
    client.on('reconnect', () => onStatus({ state: 'connecting', detail: `reconnecting to ${this.config.url}` }))
    client.on('close', () => this.onDisconnect?.())
    client.on('offline', () => onStatus({ state: 'connecting', detail: 'offline' }))
    client.on('error', (err) => onStatus({ state: 'error', detail: err.message }))
  }

  async stop(): Promise<void> {
    const c = this.client
    this.client = null
    if (c) await c.endAsync()
  }
}
