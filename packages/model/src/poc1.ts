// POC1: the legacy topics and payloads on the shared PoC broker, still used by the
// test devices alongside firstmile/a. Observed 28–29 Oct 2026 on the broker:
//   topic    firstmile/poc1/<group>/{metadata|data}/<node>   ("meta" also seen)
//   payload  a bare Metadata or Data message: no FirstMileMessage envelope (the topic says which)
//   Node     the numbering before the 16 Jun 2026 "fix .proto file" commit, which gave `name` its own
//            field: id=1, location=2, url=3, serialNumber=4, firmwareVersion=5, no name.
// Everything else (ObserverDevice, ParameterDefinition, Parameter, namespaces, Data) is wire-compatible
// with the current schema (the July Value renames kept their field numbers).
import protobuf from 'protobufjs/light.js'
import descriptor from './generated/fmde.json'
import { FMDE_PACKAGE, type RawData, type RawFirstMileMessage, type RawMetadata } from './proto'
import type { NodeKey } from './types'

export const POC1_ROOT = 'firstmile/poc1'
export const POC1_TOPIC_FILTER = `${POC1_ROOT}/#`

export type TopicProfile = 'a' | 'poc1'

export interface FirstMileTopic {
  profile: TopicProfile
  group: string
  nodeId: string
  nodeKey: NodeKey
  /** POC1 only: the message kind named by the topic */
  kind?: 'metadata' | 'data'
  /** POC1 only: the kind level as published ("metadata", "meta" or "data") */
  kindLevel?: string
}

/** Parse firstmile/a/<group>/<node> or firstmile/poc1/<group>/<kind>/<node>; null if neither. */
export function parseFirstMileTopic(topic: string): FirstMileTopic | null {
  const parts = topic.split('/')
  if (parts[0] !== 'firstmile') return null
  if (parts[1] === 'a' && parts.length === 4 && parts[2] && parts[3]) {
    return { profile: 'a', group: parts[2], nodeId: parts[3], nodeKey: `${parts[2]}/${parts[3]}` }
  }
  if (parts[1] === 'poc1' && parts.length === 5 && parts[2] && parts[4]) {
    const level = parts[3]!
    const kind = level === 'metadata' || level === 'meta' ? 'metadata' : level === 'data' ? 'data' : null
    if (!kind) return null
    return { profile: 'poc1', group: parts[2], nodeId: parts[4], nodeKey: `${parts[2]}/${parts[4]}`, kind, kindLevel: level }
  }
  return null
}

// A copy of the generated descriptor with Node renumbered to the POC1 layout.
function legacyDescriptor(): protobuf.INamespace {
  const d = JSON.parse(JSON.stringify(descriptor)) as { nested: Record<string, { nested: Record<string, unknown> }> }
  let ns: { nested?: Record<string, unknown> } = d as never
  for (const part of FMDE_PACKAGE.split('.')) ns = (ns.nested as Record<string, { nested?: Record<string, unknown> }>)[part]!
  const node = (ns.nested as Record<string, { fields: Record<string, { type: string; id: number; options?: unknown }> }>).Node!
  const { name: _name, ...fields } = node.fields
  node.fields = {
    ...fields,
    id: { ...fields.id!, id: 1 },
    location: { ...fields.location!, id: 2 },
    url: { ...fields.url!, id: 3 },
    serialNumber: { ...fields.serialNumber!, id: 4 },
    firmwareVersion: { ...fields.firmwareVersion!, id: 5 },
  }
  return d as protobuf.INamespace
}

const legacyRoot = protobuf.Root.fromJSON(legacyDescriptor())
const LegacyMetadata = legacyRoot.lookupType(`${FMDE_PACKAGE}.Metadata`)
const LegacyData = legacyRoot.lookupType(`${FMDE_PACKAGE}.Data`)
const TO_OBJECT: protobuf.IConversionOptions = { longs: String, enums: String, defaults: false, oneofs: true }

/** Decode a POC1 payload (bare Metadata or Data, per the topic). Throws on malformed input. */
export function decodePoc1(bytes: Uint8Array, kind: 'metadata' | 'data'): RawFirstMileMessage {
  if (kind === 'metadata') {
    const metadata = LegacyMetadata.toObject(LegacyMetadata.decode(bytes), TO_OBJECT) as RawMetadata
    return { content: 'metadata', metadata }
  }
  const data = LegacyData.toObject(LegacyData.decode(bytes), TO_OBJECT) as RawData
  return { content: 'data', data }
}

/** Encode a POC1 payload (for tests and fixtures). */
export function encodePoc1(kind: 'metadata' | 'data', obj: RawMetadata | RawData | Record<string, unknown>): Uint8Array {
  const T = kind === 'metadata' ? LegacyMetadata : LegacyData
  return T.encode(T.fromObject(obj)).finish()
}
