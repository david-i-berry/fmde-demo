// Topology model: hub → broker → group → node → observer device → parameters.
// Parameters attach to the device named in their DeviceRef. Pure functions; the Vue component renders.
import type { NodeState } from '@nodal/model'
import ELK from 'elkjs/lib/elk.bundled.js'
import type { NetworkExtras, NetworkNode } from './network'
import { STATE_HEX, worstState } from './state'

export type TopoKind = 'hub' | 'broker' | 'group' | 'node' | 'observer' | 'parameter'

export interface TopoNode {
  id: string
  kind: TopoKind
  label: string
  sublabel?: string
  state?: NodeState
  /** node: key to open; group: member count per state */
  nodeKey?: string
  counts?: Partial<Record<NodeState, number>>
  battery?: { value: number; unit: string } | null
  emptyValues?: number
  width: number
  height: number
}

export interface TopoEdge {
  id: string
  source: string
  target: string
  /** state that colours the link; undefined = neutral */
  state?: NodeState
  /** a parameter with empty values in the window */
  attention?: boolean
}

export interface TopoOptions {
  showParameters: boolean
  collapseGroups: boolean
}

const SIZE: Record<TopoKind, [number, number]> = {
  hub: [150, 48],
  broker: [210, 48],
  group: [190, 64],
  node: [240, 86],
  observer: [220, 48],
  parameter: [210, 40],
}

export function buildTopology(network: NetworkNode[], extras: NetworkExtras, options: TopoOptions): { nodes: TopoNode[]; edges: TopoEdge[] } {
  const nodes: TopoNode[] = []
  const edges: TopoEdge[] = []
  const add = (n: Omit<TopoNode, 'width' | 'height'>) => {
    const [width, height] = SIZE[n.kind]
    nodes.push({ ...n, width, height })
  }
  const link = (source: string, target: string, state?: NodeState, attention?: boolean) =>
    edges.push({ id: `${source}->${target}`, source, target, state, attention })

  add({ id: 'hub', kind: 'hub', label: 'Hub', sublabel: 'this app' })
  add({ id: 'broker', kind: 'broker', label: 'Broker', sublabel: extras.brokerLabel })
  link('hub', 'broker')

  const groups = new Map<string, NetworkNode[]>()
  for (const n of network) groups.set(n.status.group, [...(groups.get(n.status.group) ?? []), n])

  for (const [group, members] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const gid = `group:${group}`
    const counts: Partial<Record<NodeState, number>> = {}
    for (const m of members) counts[m.status.state] = (counts[m.status.state] ?? 0) + 1
    const worst = worstState(members.map((m) => m.status.state)) ?? undefined
    add({ id: gid, kind: 'group', label: group, sublabel: `${members.length} node(s)`, state: worst, counts })
    link('broker', gid, worst)
    if (options.collapseGroups) continue

    for (const m of members) {
      const s = m.status
      const nid = `node:${s.nodeKey}`
      add({
        id: nid,
        kind: 'node',
        label: m.metadata?.node.name || s.name || s.nodeId,
        sublabel: s.nodeKey,
        state: s.state,
        nodeKey: s.nodeKey,
        battery: m.battery ? { value: m.battery.value, unit: m.battery.unit } : null,
      })
      link(gid, nid, s.state)
      if (!m.metadata) continue

      for (const o of m.metadata.observers) {
        const oid = `${nid}/obs:${o.id}`
        add({
          id: oid,
          kind: 'observer',
          label: o.name || `observer ${o.id}`,
          sublabel: [o.serialNumber, o.firmwareVersion && `fw ${o.firmwareVersion}`].filter(Boolean).join(' · ') || undefined,
          nodeKey: s.nodeKey,
        })
        link(nid, oid)
      }
      if (!options.showParameters) continue
      for (const p of m.metadata.parameters) {
        const pid = `${nid}/param:${p.key}`
        const empties = extras.emptyBySeries?.[p.seriesKey] ?? 0
        const parent = p.device.kind === 'observer' && m.metadata.observers.some((o) => o.id === (p.device as { observerId: number }).observerId)
          ? `${nid}/obs:${p.device.observerId}`
          : nid
        add({ id: pid, kind: 'parameter', label: p.longName, sublabel: `${p.unit} · ${p.cellMethod.toLowerCase()}`, nodeKey: s.nodeKey, emptyValues: empties })
        link(parent, pid, undefined, empties > 0)
      }
    }
  }
  return { nodes, edges }
}

export function edgeColour(e: TopoEdge, neutral: string, attention: string): string {
  if (e.attention) return attention
  return e.state ? STATE_HEX[e.state] : neutral
}

const elk = new ELK()

/** Layered left-to-right layout (ELK). Returns top-left positions by node id. */
export async function layoutLayered(nodes: TopoNode[], edges: TopoEdge[]): Promise<Map<string, { x: number; y: number }>> {
  const res = await elk.layout({
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.layered.spacing.nodeNodeBetweenLayers': '70',
      'elk.spacing.nodeNode': '18',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      'elk.edgeRouting': 'SPLINES',
    },
    children: nodes.map((n) => ({ id: n.id, width: n.width, height: n.height })),
    edges: edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  })
  return new Map((res.children ?? []).map((c) => [c.id, { x: c.x ?? 0, y: c.y ?? 0 }]))
}
