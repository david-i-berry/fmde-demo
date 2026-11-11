// Decode, validate, version metadata, INSERT. Runs only in the leader tab's worker.
import { CHANGE_CHANNEL, type Db, type Tx } from '@nodal/db'
import {
  canonicalJson,
  checkMetadata,
  checkTopic,
  CODE_INFO,
  decodeData,
  decodeMessage,
  decodePoc1,
  normaliseMetadata,
  parseFirstMileTopic,
  severityFor,
  sha256Hex,
  type ConformanceIssue,
  type MetadataVersion,
  type NodeKey,
  type Observation,
  type RawFirstMileMessage,
  type RawMetadata,
} from '@nodal/model'
import type { IncomingMessage, IngestEvent } from './types'

export interface IngestorOptions {
  /** NOTIFY CHANGE_CHANNEL after each batch (default true). */
  notify?: boolean
}

export class Ingestor {
  /** Metadata in force per node, so data decoding does not hit the database. */
  private metadata = new Map<NodeKey, MetadataVersion | null>()
  private futureToleranceSeconds = 60

  constructor(
    private readonly db: Db,
    private readonly options: IngestorOptions = {},
  ) {}

  async init(): Promise<void> {
    const res = await this.db.query<{ v: number }>(
      `select (value #>> '{}')::double precision as v from nodal_setting where key = 'futureToleranceSeconds'`,
    )
    this.futureToleranceSeconds = res.rows[0]?.v ?? 60
  }

  /** Ingest messages in one transaction, then notify readers once. */
  async ingestBatch(messages: IncomingMessage[]): Promise<IngestEvent[]> {
    if (messages.length === 0) return []
    // Hashing is async Web Crypto, so do it before the transaction.
    const prepared = await Promise.all(messages.map((m) => this.prepare(m)))
    const events: IngestEvent[] = []
    const cacheBefore = new Map(this.metadata)
    try {
      await this.db.transaction(async (tx) => {
        for (const p of prepared) events.push(await this.write(tx, p))
      })
    } catch (e) {
      this.metadata = cacheBefore
      if (messages.length === 1) throw e
      // Isolate the failing message so one bad message does not lose the batch.
      events.length = 0
      for (const m of messages) {
        try {
          events.push(...(await this.ingestBatch([m])))
        } catch (err) {
          console.error('nodal ingest: message dropped', m.topic, err)
        }
      }
      return events
    }
    if (this.options.notify !== false) await this.db.query(`select pg_notify($1, $2)`, [CHANGE_CHANNEL, String(events.length)])
    return events
  }

  async ingest(message: IncomingMessage): Promise<IngestEvent> {
    const [event] = await this.ingestBatch([message])
    return event!
  }

  private async prepare(m: IncomingMessage): Promise<Prepared> {
    const topic = parseFirstMileTopic(m.topic)
    const base = { m, topic, messageId: await sha256Hex(m.topic, '\0', m.payload) }
    if (m.payload.length === 0) return { ...base, kind: 'cleared' }
    let decoded: RawFirstMileMessage
    try {
      // POC1: a bare Metadata/Data message (the topic says which) in the legacy layout (poc1.ts)
      decoded = topic?.profile === 'poc1' ? decodePoc1(m.payload, topic.kind!) : decodeMessage(m.payload)
    } catch (e) {
      return { ...base, kind: 'error', error: e instanceof Error ? e.message : String(e) }
    }
    if (decoded.metadata) {
      return { ...base, kind: 'metadata', metadata: decoded.metadata, contentHash: await sha256Hex(canonicalJson(decoded.metadata)) }
    }
    if (decoded.data) return { ...base, kind: 'data', decoded }
    return { ...base, kind: 'empty' }
  }

  private async write(tx: Tx, p: Prepared): Promise<IngestEvent> {
    const { m, topic } = p
    const event: IngestEvent = {
      receivedAt: m.receivedAt,
      topic: m.topic,
      nodeKey: topic?.nodeKey ?? null,
      kind: p.kind === 'metadata' || p.kind === 'data' || p.kind === 'cleared' ? p.kind : 'unknown',
      messageId: p.messageId,
      payloadBytes: m.payload.length,
      retain: m.retain,
      profile: topic?.profile,
      issues: [],
    }

    if (!topic) {
      event.issues.push({ code: 'BAD_TOPIC', detail: `"${m.topic}" is not firstmile/a/<group>/<node> (or POC1 firstmile/poc1/<group>/<metadata|data>/<node>)` })
      await this.recordIssues(tx, event)
      return event
    }

    const created = await tx.query(
      `insert into node (node_key, group_id, node_id, topic, first_seen_at) values ($1, $2, $3, $4, $5)
       on conflict (node_key) do nothing returning node_key`,
      [topic.nodeKey, topic.group, topic.nodeId, m.topic, m.receivedAt],
    )
    // ATS transmission tests on a new node's topic (metadata re-checks it with each new version)
    if (created.rows.length > 0 && p.kind !== 'metadata') event.issues.push(...checkTopic(m.topic, topic.group, topic.nodeId))

    switch (p.kind) {
      case 'cleared':
        if (m.retain) {
          event.issues.push({ code: 'METADATA_CLEARED', detail: 'zero-length retained message: retained metadata deleted' })
          await tx.query(`update node set metadata_cleared_at = $2 where node_key = $1`, [topic.nodeKey, m.receivedAt])
          this.metadata.set(topic.nodeKey, null)
        } else {
          event.issues.push({ code: 'DECODE_ERROR', detail: 'zero-length payload' })
        }
        break
      case 'error':
        event.issues.push({ code: 'DECODE_ERROR', detail: p.error })
        break
      case 'empty':
        event.issues.push({ code: 'EMPTY_MESSAGE', detail: 'FirstMileMessage has neither metadata nor data' })
        break
      case 'metadata':
        await this.writeMetadata(tx, p, topic, event)
        break
      case 'data':
        await this.writeData(tx, p, topic.nodeKey, event)
        break
    }
    await this.recordIssues(tx, event)
    return event
  }

  private async writeMetadata(tx: Tx, p: PreparedMetadata, topic: NonNullable<Prepared['topic']>, event: IngestEvent) {
    const { m } = p
    if (m.retainReliable && !m.retain) {
      event.issues.push({ code: 'METADATA_NOT_RETAINED', detail: 'metadata message published without the retained flag' })
    }

    const current = await tx.query<{ metadata_version: number | null; metadata_hash: string | null }>(
      `select metadata_version, metadata_hash from node where node_key = $1`,
      [topic.nodeKey],
    )
    const row = current.rows[0]
    if (row?.metadata_hash === p.contentHash && row.metadata_version !== null) {
      // Identical republish (reconnect, retained redelivery): not a new version.
      await tx.query(`update node set metadata_seen_at = $2, metadata_cleared_at = null where node_key = $1`, [topic.nodeKey, m.receivedAt])
      event.metadataVersion = row.metadata_version
      event.newMetadataVersion = false
      return
    }

    const version = (row?.metadata_version ?? 0) + 1
    const { metadata, issues } = normaliseMetadata(p.metadata, {
      ...topic,
      topic: m.topic,
      version,
      receivedAt: m.receivedAt,
      contentHash: p.contentHash,
      rawBytes: m.payload.length,
    })
    // FMDE ATS: topic and metadata tests, run once per metadata version
    const found = [...checkTopic(m.topic, topic.group, topic.nodeId), ...checkMetadata(p.metadata), ...issues]
    if (topic.profile === 'poc1') {
      // the legacy Node layout has no name field: report the layout once, not a missing name
      event.issues.push({ code: 'POC1_LEGACY_ENCODING', detail: 'bare Metadata without FirstMileMessage envelope; Node numbered id=1, location=2, url=3, serialNumber=4, firmwareVersion=5' })
      if (topic.kindLevel === 'meta') event.issues.push({ code: 'POC1_TOPIC_LEVEL', detail: `topic level "meta" in ${m.topic}` })
      event.issues.push(...found.filter((i) => i.code !== 'NODE_NO_NAME'))
    } else {
      event.issues.push(...found)
    }
    event.metadataVersion = version
    event.newMetadataVersion = true

    await tx.query(
      `insert into metadata_version (node_key, version, received_at, content_hash, message, normalised, raw_bytes, raw)
       values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8)`,
      [topic.nodeKey, version, m.receivedAt, p.contentHash, JSON.stringify(p.metadata), JSON.stringify(metadata), m.payload.length, m.payload],
    )
    for (const o of metadata.observers) {
      await tx.query(
        `insert into observer_device (node_key, metadata_version, id, name, serial_number, firmware_version, url, location)
         values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb) on conflict do nothing`,
        [topic.nodeKey, version, o.id, o.name, o.serialNumber ?? null, o.firmwareVersion ?? null, o.url ?? null, o.location ? JSON.stringify(o.location) : null],
      )
    }
    const ps = metadata.parameters
    if (ps.length > 0) {
      await tx.query(
        `insert into parameter (node_key, metadata_version, definition_id, value_index, param_key, series_key,
           definition_description, long_name, unit, standard_names, device_kind, observer_id, cell_method, cell_period_seconds)
         select $1, $2, d, i, k, s, dd, ln, u, sn::jsonb, dk, oi, cm, cp
         from unnest($3::bigint[], $4::int[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::text[],
                     $11::text[], $12::bigint[], $13::text[], $14::bigint[]) as t(d, i, k, s, dd, ln, u, sn, dk, oi, cm, cp)`,
        [
          topic.nodeKey,
          version,
          ps.map((x) => x.definitionId),
          ps.map((x) => x.valueIndex),
          ps.map((x) => x.key),
          ps.map((x) => x.seriesKey),
          ps.map((x) => x.definitionDescription),
          ps.map((x) => x.longName),
          ps.map((x) => x.unit),
          ps.map((x) => JSON.stringify(x.standardNames)),
          ps.map((x) => x.device.kind),
          ps.map((x) => (x.device.kind === 'observer' ? x.device.observerId : null)),
          ps.map((x) => x.cellMethod),
          ps.map((x) => x.cellPeriodSeconds),
        ],
      )
    }
    const n = metadata.node
    await tx.query(
      `update node set declared_id = $2, name = $3, serial_number = $4, firmware_version = $5, url = $6, location = $7::jsonb,
         metadata_version = $8, metadata_hash = $9, metadata_received_at = $10, metadata_seen_at = $10, metadata_cleared_at = null
       where node_key = $1`,
      [topic.nodeKey, n.declaredId ?? null, n.name, n.serialNumber ?? null, n.firmwareVersion ?? null, n.url ?? null,
       n.location ? JSON.stringify(n.location) : null, version, p.contentHash, m.receivedAt],
    )
    this.metadata.set(topic.nodeKey, metadata)
  }

  private async metadataFor(tx: Tx, nodeKey: NodeKey): Promise<MetadataVersion | null> {
    if (this.metadata.has(nodeKey)) return this.metadata.get(nodeKey)!
    const res = await tx.query<{ normalised: MetadataVersion }>(
      `select mv.normalised from node n join metadata_version mv on mv.node_key = n.node_key and mv.version = n.metadata_version
       where n.node_key = $1 and n.metadata_cleared_at is null`,
      [nodeKey],
    )
    const md = res.rows[0]?.normalised ?? null
    this.metadata.set(nodeKey, md)
    return md
  }

  private async writeData(tx: Tx, p: PreparedData, nodeKey: NodeKey, event: IngestEvent) {
    const { m } = p
    const dup = await tx.query(`select 1 from data_message where id = $1`, [p.messageId])
    if (dup.rows.length > 0) {
      event.duplicate = true
      return
    }
    if (m.retain) event.issues.push({ code: 'DATA_RETAINED', detail: 'data message published with the retained flag' })

    const metadata = await this.metadataFor(tx, nodeKey)
    const d = decodeData(p.decoded.data!, {
      nodeKey,
      messageId: p.messageId,
      receivedAt: m.receivedAt,
      metadata,
      futureToleranceSeconds: this.futureToleranceSeconds,
    })
    event.issues.push(...d.issues)
    event.observations = d.observationCount
    event.metadataVersion = metadata?.version ?? null

    const received = Date.parse(m.receivedAt)
    const secondsSince = (iso: string | null) => (iso === null ? null : (received - Date.parse(iso)) / 1000)
    await tx.query(
      `insert into data_message (id, node_key, topic, received_at, first_obs_time, last_obs_time, observations, values_count,
         empty_values, latency_seconds, span_seconds, payload_bytes, raw, metadata_version, conformance)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb)`,
      [p.messageId, nodeKey, m.topic, m.receivedAt, d.firstObsTime, d.lastObsTime, d.observationCount, d.valueCount,
       d.emptyValueCount, secondsSince(d.lastObsTime), secondsSince(d.firstObsTime), m.payload.length, m.payload,
       metadata?.version ?? null, JSON.stringify(event.issues)],
    )
    await insertObservations(tx, d.observations)
  }

  private async recordIssues(tx: Tx, event: IngestEvent) {
    if (event.issues.length === 0) return
    await tx.query(
      `insert into conformance_issue (received_at, topic, node_key, message_id, kind, code, severity, test, detail)
       select $1, $2, $3, $4, $5, c, s, t, d from unnest($6::text[], $7::text[], $8::text[], $9::text[]) as x(c, s, t, d)`,
      [event.receivedAt, event.topic, event.nodeKey, event.messageId, event.kind,
       event.issues.map((i) => i.code),
       event.issues.map((i) => severityFor(i.code, event.profile)),
       event.issues.map((i) => CODE_INFO[i.code].test ?? null),
       event.issues.map((i) => i.detail)],
    )
  }

  /** Delete observations, messages and issues past retention. */
  async prune(now = new Date()): Promise<void> {
    await this.db.query(`select nodal_prune($1)`, [now])
  }
}

async function insertObservations(tx: Tx, obs: Observation[]) {
  if (obs.length === 0) return
  const num = (o: Observation) => (typeof o.value === 'number' ? o.value : null)
  const text = (o: Observation) => (typeof o.value === 'string' ? o.value : (o.exact ?? null))
  const bool = (o: Observation) => (typeof o.value === 'boolean' ? o.value : null)
  await tx.query(
    `insert into observation (series_key, obs_time, node_key, param_key, metadata_version, definition_id, value_kind,
       value_num, value_text, value_bool, is_empty, message_id, received_at)
     select * from unnest($1::text[], $2::timestamptz[], $3::text[], $4::text[], $5::int[], $6::bigint[], $7::text[],
                          $8::float8[], $9::text[], $10::bool[], $11::bool[], $12::text[], $13::timestamptz[])
     on conflict (series_key, obs_time) do nothing`,
    [
      obs.map((o) => o.seriesKey),
      obs.map((o) => o.time),
      obs.map((o) => o.nodeKey),
      obs.map((o) => o.paramKey),
      obs.map((o) => o.metadataVersion),
      obs.map((o) => o.definitionId),
      obs.map((o) => o.kind),
      obs.map(num),
      obs.map(text),
      obs.map(bool),
      obs.map((o) => o.value === null),
      obs.map((o) => o.messageId),
      obs.map((o) => o.receivedAt),
    ],
  )
}

interface PreparedBase {
  m: IncomingMessage
  topic: ReturnType<typeof parseFirstMileTopic>
  messageId: string
}
interface PreparedMetadata extends PreparedBase {
  kind: 'metadata'
  metadata: RawMetadata
  contentHash: string
}
interface PreparedData extends PreparedBase {
  kind: 'data'
  decoded: RawFirstMileMessage
}
type Prepared =
  | PreparedMetadata
  | PreparedData
  | (PreparedBase & { kind: 'cleared' | 'empty' })
  | (PreparedBase & { kind: 'error'; error: string })

export type { ConformanceIssue }
