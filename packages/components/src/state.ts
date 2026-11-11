import type { Conformance, NodeState } from '@nodal/model'

/** Never colour alone: every state has an icon and a label. */
export const STATE_META: Record<NodeState, { label: string; color: string; icon: string; description: string }> = {
  NO_METADATA: { label: 'No metadata', color: 'purple', icon: 'mdi-file-question-outline', description: 'Data arrives but no retained metadata exists, so it cannot be decoded' },
  NEVER_SEEN: { label: 'Never seen', color: 'grey', icon: 'mdi-eye-off-outline', description: 'Metadata received, but no data message yet' },
  SILENT: { label: 'Silent', color: 'error', icon: 'mdi-access-point-off', description: 'No data message for longer than the silent threshold' },
  LATE: { label: 'Late', color: 'warning', icon: 'mdi-clock-alert-outline', description: 'No data message for longer than the late threshold' },
  DEGRADED: {
    label: 'Degraded',
    color: 'amber-darken-2',
    icon: 'mdi-alert-outline',
    description: 'Reporting, but data was lost in the window: empty values (other than expected ones), or observations that could not be decoded',
  },
  OK: { label: 'OK', color: 'success', icon: 'mdi-check-circle-outline', description: 'Reporting normally' },
}

/** Display order, most urgent first; never-seen nodes last (and hidden by default). */
export const STATE_ORDER: NodeState[] = ['NO_METADATA', 'SILENT', 'LATE', 'DEGRADED', 'OK', 'NEVER_SEEN']

/** Status hues for canvases (map, graph) that cannot use Vuetify colour names; reference status palette. */
export const STATE_HEX: Record<NodeState, string> = {
  NO_METADATA: '#6250d6',
  NEVER_SEEN: '#898781',
  SILENT: '#d03b3b',
  LATE: '#ec835a',
  DEGRADED: '#fab219',
  OK: '#0ca30c',
}

/** Higher = worse; used to colour clusters and groups by their worst member. */
export const STATE_RANK: Record<NodeState, number> = { NEVER_SEEN: 0, OK: 1, DEGRADED: 2, LATE: 3, SILENT: 4, NO_METADATA: 5 }

export function worstState(states: NodeState[]): NodeState | null {
  return states.reduce<NodeState | null>((w, s) => (w === null || STATE_RANK[s] > STATE_RANK[w] ? s : w), null)
}

/** Conformance is separate from state: a node can work fine and still not meet FMDE. */
export const CONFORMANCE_META: Record<Conformance, { label: string; color: string; icon: string; description: string }> = {
  CONFORMANT: { label: 'Conformant', color: 'success', icon: 'mdi-check-decagram-outline', description: 'No conformance issues in the current metadata or recent data' },
  WARNINGS: { label: 'Warnings', color: 'warning', icon: 'mdi-alert-decagram-outline', description: 'Only warnings: legacy POC1 differences, hub heuristics, or points where the ATS and the requirements disagree' },
  NON_CONFORMANT: { label: 'Non-conformant', color: 'error', icon: 'mdi-close-octagon-outline', description: 'Fails FMDE requirements in the current metadata or recent data' },
}

export const CONFORMANCE_ORDER: Conformance[] = ['NON_CONFORMANT', 'WARNINGS', 'CONFORMANT']
