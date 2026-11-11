import type { PGliteInterface, Transaction } from '@electric-sql/pglite'
import type { Conformance, NodeState, NodeStatus } from '@nodal/model'
import m0001 from './migrations/0001_init.sql?raw'
import m0002 from './migrations/0002_metrics.sql?raw'
import m0003 from './migrations/0003_state_and_conformance.sql?raw'

/** Numbered migrations, applied in order at start-up. Never edit one that has shipped; add a new one. */
export const MIGRATIONS: { id: number; name: string; sql: string }[] = [
  { id: 1, name: '0001_init', sql: m0001 },
  { id: 2, name: '0002_metrics', sql: m0002 },
  { id: 3, name: '0003_state_and_conformance', sql: m0003 },
]

export type Db = PGliteInterface
export type Tx = Transaction | PGliteInterface

export async function migrate(db: Db): Promise<number[]> {
  await db.exec(`create table if not exists nodal_migration (
    id integer primary key, name text not null, applied_at timestamptz not null default now())`)
  const done = new Set((await db.query<{ id: number }>('select id from nodal_migration')).rows.map((r) => r.id))
  const applied: number[] = []
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue
    await db.transaction(async (tx) => {
      await tx.exec(m.sql)
      await tx.query('insert into nodal_migration (id, name) values ($1, $2)', [m.id, m.name])
    })
    applied.push(m.id)
  }
  return applied
}

/** Channel NOTIFYed after each ingest batch; readers of metric functions refresh on it. */
export const CHANGE_CHANNEL = 'nodal_changed'

interface NodeStatusRow {
  node_key: string
  group_id: string
  node_id: string
  name: string | null
  state: NodeState
  conformance: Conformance
  metadata_version: number | null
  first_seen_at: Date
  last_seen_at: Date | null
  last_seen_age_seconds: number | null
  messages: number | bigint
  observations: number | bigint
  empty_values: number | bigint
  expected_empty_values: number | bigint
  lost_data: number | bigint
  conformance_errors: number | bigint
  conformance_warnings: number | bigint
  median_latency_seconds: number | null
  max_span_seconds: number | null
}

export const NODE_STATUS_SQL = 'select * from nodal_node_status($1, $2, $3)'

export function toNodeStatus(r: NodeStatusRow): NodeStatus {
  return {
    nodeKey: r.node_key,
    group: r.group_id,
    nodeId: r.node_id,
    name: r.name,
    state: r.state,
    conformance: r.conformance,
    metadataVersion: r.metadata_version,
    firstSeenAt: r.first_seen_at.toISOString(),
    lastSeenAt: r.last_seen_at?.toISOString() ?? null,
    lastSeenAgeSeconds: r.last_seen_age_seconds,
    messages: Number(r.messages),
    observations: Number(r.observations),
    emptyValues: Number(r.empty_values),
    expectedEmptyValues: Number(r.expected_empty_values),
    lostData: Number(r.lost_data),
    conformanceErrors: Number(r.conformance_errors),
    conformanceWarnings: Number(r.conformance_warnings),
    medianLatencySeconds: r.median_latency_seconds,
    maxSpanSeconds: r.max_span_seconds,
  }
}

export async function nodeStatus(db: Db, from: Date, to: Date, now: Date): Promise<NodeStatus[]> {
  const res = await db.query<NodeStatusRow>(NODE_STATUS_SQL, [from, to, now])
  return res.rows.map(toNodeStatus)
}
