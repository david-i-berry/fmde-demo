// Domain composables: the only place views get data from. Components take model types as props.
import type { ArrivalPoint, NetworkExtras, NetworkNode, ParamPoint } from '@nodal/components'
import { NODE_STATUS_SQL, toNodeStatus } from '@nodal/db'
import { healthParameter, type ConformanceCode, type MetadataVersion, type NodeHubConfig, type NodeKey, type NodeStatus, type ObsValue, type RawMetadata, type SeriesKey } from '@nodal/model'
import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useTimeWindow, useUiStore } from '../stores/ui'
import { useQuery } from './useQuery'

export function useNodeStatus() {
  const w = useTimeWindow()
  return useQuery(NODE_STATUS_SQL, () => [w.from.value, w.to.value, w.to.value], (rows) =>
    rows.map((r) => toNodeStatus(r as Parameters<typeof toNodeStatus>[0])),
  ) as ReturnType<typeof useQuery<unknown, NodeStatus>>
}

export interface IssueRow {
  id: number
  receivedAt: string
  topic: string
  nodeKey: NodeKey | null
  kind: string
  code: ConformanceCode
  detail: string
}

export function useIssues(nodeKey: MaybeRefOrGetter<NodeKey | null> = null, limit = 50) {
  const w = useTimeWindow()
  return useQuery<Record<string, unknown>, IssueRow>(
    `select id, received_at, topic, node_key, kind, code, detail from conformance_issue
     where received_at >= $1 and received_at < $2 and ($3::text is null or node_key = $3)
     order by received_at desc limit ${Number(limit)}`,
    () => [w.from.value, w.to.value, toValue(nodeKey)],
    (rows) =>
      rows.map((r) => ({
        id: Number(r.id),
        receivedAt: (r.received_at as Date).toISOString(),
        topic: r.topic as string,
        nodeKey: r.node_key as string | null,
        kind: r.kind as string,
        code: r.code as ConformanceCode,
        detail: r.detail as string,
      })),
  )
}

export interface IssueSummaryRow {
  nodeKey: NodeKey | null
  code: ConformanceCode
  severity: 'error' | 'warning'
  count: number
  lastAt: string
  lastDetail: string
}

/** Issues in the window grouped by node and code, errors first. */
export function useIssueSummary(limit = 20) {
  const w = useTimeWindow()
  return useQuery<Record<string, unknown>, IssueSummaryRow>(
    `select node_key, code, severity, count(*)::int as n, max(received_at) as last_at,
            (array_agg(detail order by received_at desc))[1] as last_detail
     from conformance_issue where received_at >= $1 and received_at < $2
     group by node_key, code, severity
     order by (severity = 'error') desc, max(received_at) desc limit ${Number(limit)}`,
    () => [w.from.value, w.to.value],
    (rows) =>
      rows.map((r) => ({
        nodeKey: r.node_key as string | null,
        code: r.code as ConformanceCode,
        severity: r.severity as 'error' | 'warning',
        count: r.n as number,
        lastAt: (r.last_at as Date).toISOString(),
        lastDetail: r.last_detail as string,
      })),
  )
}

export function useCurrentMetadata(nodeKey: MaybeRefOrGetter<NodeKey>) {
  const q = useQuery<{ normalised: MetadataVersion; message: RawMetadata }>(
    `select mv.normalised, mv.message from node n join metadata_version mv on mv.node_key = n.node_key and mv.version = n.metadata_version
     where n.node_key = $1`,
    () => [toValue(nodeKey)],
  )
  return {
    ...q,
    metadata: computed(() => q.rows.value[0]?.normalised ?? null),
    /** The decoded Metadata as received, for the conformance tests. */
    raw: computed(() => q.rows.value[0]?.message ?? null),
  }
}

export function useMetadataVersions(nodeKey: MaybeRefOrGetter<NodeKey>) {
  return useQuery<{ normalised: MetadataVersion }, MetadataVersion>(
    `select normalised from metadata_version where node_key = $1 order by version desc`,
    () => [toValue(nodeKey)],
    (rows) => rows.map((r) => r.normalised),
  )
}

interface ObsRow {
  series_key: string
  obs_time: Date
  value_num: number | null
  value_text: string | null
  value_bool: boolean | null
  is_empty: boolean
}
const obsValue = (r: ObsRow): ObsValue => (r.is_empty ? null : (r.value_num ?? r.value_text ?? r.value_bool))

export function useLatestValues(nodeKey: MaybeRefOrGetter<NodeKey>) {
  const q = useQuery<ObsRow>(
    `select distinct on (series_key) series_key, obs_time, value_num, value_text, value_bool, is_empty
     from observation where node_key = $1 order by series_key, obs_time desc`,
    () => [toValue(nodeKey)],
  )
  const latest = computed(() => {
    const out: Record<SeriesKey, { time: string; value: ObsValue }> = {}
    for (const r of q.rows.value) out[r.series_key] = { time: r.obs_time.toISOString(), value: obsValue(r) }
    return out
  })
  return { ...q, latest }
}

/** Numeric series per SeriesKey within the window (emptyValue as null). */
export function useSeries(nodeKey: MaybeRefOrGetter<NodeKey>) {
  const w = useTimeWindow()
  const q = useQuery<ObsRow>(
    `select series_key, obs_time, value_num, value_text, value_bool, is_empty from observation
     where node_key = $1 and obs_time >= $2 and obs_time < $3 order by obs_time`,
    () => [toValue(nodeKey), w.from.value, w.to.value],
  )
  const series = computed(() => {
    const out = new Map<SeriesKey, ParamPoint[]>()
    for (const r of q.rows.value) {
      if (!r.is_empty && r.value_num === null) continue // non-numeric values are not charted
      const list = out.get(r.series_key) ?? []
      list.push({ t: r.obs_time.toISOString(), v: r.is_empty ? null : r.value_num })
      out.set(r.series_key, list)
    }
    return out
  })
  /** every series with an observation in the window, charted or not (text and boolean values) */
  const observed = computed(() => new Set(q.rows.value.map((r) => r.series_key)))
  return { ...q, series, observed }
}

export interface MessageRow extends ArrivalPoint {
  id: string
  firstObsTime: string | null
  lastObsTime: string | null
  emptyValues: number
  metadataVersion: number | null
  issues: { code: ConformanceCode; detail: string }[]
}

export function useMessages(nodeKey: MaybeRefOrGetter<NodeKey>) {
  const w = useTimeWindow()
  return useQuery<Record<string, unknown>, MessageRow>(
    `select id, received_at, first_obs_time, last_obs_time, observations, empty_values, latency_seconds, span_seconds,
            payload_bytes, metadata_version, conformance
     from data_message where node_key = $1 and received_at >= $2 and received_at < $3 order by received_at`,
    () => [toValue(nodeKey), w.from.value, w.to.value],
    (rows) =>
      rows.map((r) => ({
        id: r.id as string,
        receivedAt: (r.received_at as Date).toISOString(),
        firstObsTime: (r.first_obs_time as Date | null)?.toISOString() ?? null,
        lastObsTime: (r.last_obs_time as Date | null)?.toISOString() ?? null,
        observations: r.observations as number,
        emptyValues: r.empty_values as number,
        latencySeconds: r.latency_seconds as number | null,
        spanSeconds: r.span_seconds as number | null,
        payloadBytes: r.payload_bytes as number,
        metadataVersion: r.metadata_version as number | null,
        issues: r.conformance as MessageRow['issues'],
      })),
  )
}

/** Everything the topology graph and the map need, per node: status, current metadata, battery. */
export function useNetwork() {
  const ui = useUiStore()
  const w = useTimeWindow()
  const { rows: statuses } = useNodeStatus()
  const { rows: metas } = useQuery<{ node_key: string; normalised: MetadataVersion; hub_config: NodeHubConfig }>(
    `select n.node_key, mv.normalised, n.hub_config from node n
     join metadata_version mv on mv.node_key = n.node_key and mv.version = n.metadata_version
     where n.metadata_cleared_at is null`,
  )
  const batterySeries = computed(() =>
    metas.value.flatMap((m) => {
      const p = healthParameter(m.normalised, 'batteryVoltage', m.hub_config)
      return p ? [{ nodeKey: m.node_key, seriesKey: p.seriesKey, unit: p.unit }] : []
    }),
  )
  const { rows: battery } = useQuery<{ series_key: string; value_num: number; obs_time: Date }>(
    () =>
      batterySeries.value.length
        ? `select distinct on (series_key) series_key, value_num, obs_time from observation
           where series_key = any($1::text[]) and not is_empty and value_num is not null
           order by series_key, obs_time desc`
        : null,
    () => [batterySeries.value.map((b) => b.seriesKey)],
  )
  const { rows: empties } = useQuery<{ series_key: string; n: number }>(
    `select series_key, count(*)::int as n from observation where is_empty and obs_time >= $1 and obs_time < $2 group by series_key`,
    () => [w.from.value, w.to.value],
  )

  const network = computed<NetworkNode[]>(() => {
    const meta = new Map(metas.value.map((m) => [m.node_key, m.normalised]))
    const latest = new Map(battery.value.map((b) => [b.series_key, b]))
    // never-seen nodes (metadata, no data yet) only when asked for
    return statuses.value.filter((st) => ui.prefs.showNeverSeen || st.state !== 'NEVER_SEEN').map((status) => {
      const b = batterySeries.value.find((x) => x.nodeKey === status.nodeKey)
      const v = b ? latest.get(b.seriesKey) : undefined
      return {
        status,
        metadata: meta.get(status.nodeKey) ?? null,
        battery: b && v ? { value: v.value_num, unit: b.unit, time: v.obs_time.toISOString() } : null,
      }
    })
  })
  const extras = computed<NetworkExtras>(() => ({
    emptyBySeries: Object.fromEntries(empties.value.map((e) => [e.series_key, e.n])),
    brokerLabel:
      ui.source.source === 'replay'
        ? 'replay'
        : ui.source.source === 'mqtt'
          ? (ui.source.detail ?? '').replace(/^wss?:\/\//, '').split(/[/:]/)[0]
          : 'no source',
  }))
  return { network, extras }
}
