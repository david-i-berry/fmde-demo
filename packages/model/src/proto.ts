// FMDE protobuf encode/decode. Generated descriptor: `npm run gen:proto` (schema pinned in schemas/fmde/).
import protobuf from 'protobufjs/light.js'
import descriptor from './generated/fmde.json'

export const FMDE_PACKAGE = 'int.wmo.wis.spec.fmde.v1.conf.message_encoding'

const root = protobuf.Root.fromJSON(descriptor as protobuf.INamespace)
const FirstMileMessageType = root.lookupType(`${FMDE_PACKAGE}.FirstMileMessage`)

// Shapes produced by toObject() with TO_OBJECT options below. Fields at their proto3 default
// are omitted, so everything is optional; 64-bit integers are decimal strings.

export interface RawTimestamp { seconds?: string; nanos?: number }

export interface RawLocation {
  latitude?: number
  longitude?: number
  heightMetres?: number
  referenceSurface?: string
}

export interface RawNode {
  id?: string
  name?: string
  location?: RawLocation
  url?: string
  serialNumber?: string
  firmwareVersion?: string
}

export interface RawObserverDevice extends Omit<RawNode, 'id'> { id?: number }

export interface RawDeviceRef { node?: object; observerId?: number; target?: 'node' | 'observerId' }

export interface RawParameter {
  longName?: string
  unit?: string
  standardNames?: Record<string, string>
  device?: RawDeviceRef
  cellMethod?: string
  cellPeriodSeconds?: number
}

export interface RawParameterDefinition { id?: number; description?: string; parameters?: RawParameter[] }

export interface RawMetadata {
  node?: RawNode
  observers?: RawObserverDevice[]
  parameterDefinitions?: RawParameterDefinition[]
  namespaces?: Record<string, string>
}

export interface RawValue {
  kind?: string
  floatValue?: number
  doubleValue?: number
  int32Value?: number
  uint32Value?: number
  int64Value?: string
  uint64Value?: string
  stringValue?: string
  boolValue?: boolean
  emptyValue?: object
}

export interface RawObservation { parameterDefinitionId?: number; time?: RawTimestamp; values?: RawValue[] }

export interface RawData { observations?: RawObservation[] }

export interface RawFirstMileMessage {
  content?: 'metadata' | 'data'
  metadata?: RawMetadata
  data?: RawData
}

const TO_OBJECT: protobuf.IConversionOptions = {
  longs: String,
  enums: String,
  defaults: false,
  oneofs: true,
}

/** Decode a FirstMileMessage. Throws on malformed input. */
export function decodeMessage(bytes: Uint8Array): RawFirstMileMessage {
  const msg = FirstMileMessageType.decode(bytes)
  return FirstMileMessageType.toObject(msg, TO_OBJECT) as RawFirstMileMessage
}

/**
 * Encode a FirstMileMessage from a plain object (oneof members set directly, enums as names,
 * Empty as `{}`, Timestamp seconds as number or string).
 */
export function encodeMessage(obj: RawFirstMileMessage | Record<string, unknown>): Uint8Array {
  return FirstMileMessageType.encode(FirstMileMessageType.fromObject(obj)).finish()
}

export function timestampToIso(ts: RawTimestamp | undefined): string | null {
  if (!ts) return null
  const ms = Number(ts.seconds ?? 0) * 1000 + Math.floor((ts.nanos ?? 0) / 1e6)
  return new Date(ms).toISOString()
}
