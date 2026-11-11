import type { NodeKey } from './types'

/** Topic hierarchy version `a`: firstmile/a/<group>/<node>. */
export const TOPIC_ROOT = 'firstmile/a'
export const TOPIC_FILTER = `${TOPIC_ROOT}/#`

export interface ParsedTopic {
  group: string
  nodeId: string
  nodeKey: NodeKey
}

/** Parse a firstmile/a topic; null if it does not have exactly the four mandatory levels. */
export function parseTopic(topic: string): ParsedTopic | null {
  const parts = topic.split('/')
  if (parts.length !== 4 || parts[0] !== 'firstmile' || parts[1] !== 'a') return null
  const [, , group, nodeId] = parts as [string, string, string, string]
  if (!group || !nodeId) return null
  return { group, nodeId, nodeKey: `${group}/${nodeId}` }
}

export function topicFor(group: string, nodeId: string): string {
  return `${TOPIC_ROOT}/${group}/${nodeId}`
}
