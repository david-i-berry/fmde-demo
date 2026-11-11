// Raw FMDE protobuf objects -> normalised model, with conformance checks.
import type { RawData, RawLocation, RawMetadata, RawValue } from './proto'
import { timestampToIso } from './proto'
import {
  CELL_METHODS,
  type CellMethod,
  type ConformanceIssue,
  type DeviceTarget,
  type Location,
  type MetadataVersion,
  type NodeKey,
  type Observation,
  type ObsValue,
  type Parameter,
  type ReferenceSurface,
  type ValueKind,
} from './types'

const REFERENCE_SURFACES: ReferenceSurface[] = ['MSL', 'GEOID', 'GL', 'REFERENCE_ELLIPSOID', 'PRESSURE_1000_HPA']

/** JSON with sorted object keys, so equal content always serialises identically (used for content hashing). */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function location(raw: RawLocation | undefined): Location | undefined {
  if (!raw) return undefined
  const surface = raw.referenceSurface as ReferenceSurface | undefined
  return {
    latitude: raw.latitude,
    longitude: raw.longitude,
    heightMetres: raw.heightMetres ?? 0,
    referenceSurface: surface && REFERENCE_SURFACES.includes(surface) ? surface : 'UNSPECIFIED',
  }
}

function cellMethod(raw: string | undefined): CellMethod {
  if (!raw || raw === 'CELL_METHOD_UNSPECIFIED') return 'UNSPECIFIED'
  return (CELL_METHODS as readonly string[]).includes(raw) ? (raw as CellMethod) : 'UNSPECIFIED'
}

export function deviceLabel(d: DeviceTarget): string {
  return d.kind === 'observer' ? `obs${d.observerId}` : d.kind
}

export interface MetadataContext {
  nodeKey: NodeKey
  group: string
  nodeId: string
  topic: string
  version: number
  receivedAt: string
  contentHash: string
  rawBytes: number
}

export function normaliseMetadata(raw: RawMetadata, ctx: MetadataContext): { metadata: MetadataVersion; issues: ConformanceIssue[] } {
  const issues: ConformanceIssue[] = []
  const n = raw.node ?? {}
  const namespaces = { ...(raw.namespaces ?? {}) }

  if (n.id && n.id !== ctx.nodeId) {
    issues.push({ code: 'NODE_ID_MISMATCH', detail: `Node.id "${n.id}" differs from topic node "${ctx.nodeId}"` })
  }

  const observers = (raw.observers ?? []).map((o) => ({
    nodeKey: ctx.nodeKey,
    metadataVersion: ctx.version,
    id: o.id ?? 0,
    name: o.name ?? '',
    serialNumber: o.serialNumber,
    firmwareVersion: o.firmwareVersion,
    url: o.url,
    location: location(o.location),
  }))
  const observerIds = new Set(observers.map((o) => o.id))

  const parameters: Parameter[] = []
  const seenDefinitions = new Set<number>()
  const seenSeries = new Map<string, number>()
  const unknownPrefixes = new Set<string>()

  for (const def of raw.parameterDefinitions ?? []) {
    const definitionId = def.id ?? 0
    if (seenDefinitions.has(definitionId)) {
      issues.push({ code: 'DUPLICATE_DEFINITION_ID', detail: `parameterDefinition id ${definitionId} appears more than once` })
      continue
    }
    seenDefinitions.add(definitionId)

    ;(def.parameters ?? []).forEach((p, valueIndex) => {
      const device: DeviceTarget =
        p.device?.observerId !== undefined
          ? { kind: 'observer', observerId: p.device.observerId }
          : p.device?.node !== undefined
            ? { kind: 'node' }
            : { kind: 'unspecified' }
      if (device.kind === 'observer' && !observerIds.has(device.observerId)) {
        issues.push({ code: 'UNKNOWN_OBSERVER', detail: `definition ${definitionId}[${valueIndex}] references observer ${device.observerId}` })
      }
      const standardNames = { ...(p.standardNames ?? {}) }
      for (const prefix of Object.keys(standardNames)) {
        if (!(prefix in namespaces)) unknownPrefixes.add(prefix)
      }

      const method = cellMethod(p.cellMethod)
      const period = p.cellPeriodSeconds ?? 0
      const longName = p.longName ?? ''
      let seriesKey = [ctx.nodeKey, deviceLabel(device), longName, method, period].join('|')
      const dup = seenSeries.get(seriesKey) ?? 0
      seenSeries.set(seriesKey, dup + 1)
      if (dup > 0) seriesKey += `#${dup + 1}`

      parameters.push({
        key: `${ctx.nodeKey}/${definitionId}/${valueIndex}`,
        seriesKey,
        nodeKey: ctx.nodeKey,
        metadataVersion: ctx.version,
        definitionId,
        definitionDescription: def.description ?? '',
        valueIndex,
        longName,
        unit: p.unit ?? '',
        standardNames,
        device,
        cellMethod: method,
        cellPeriodSeconds: period,
      })
    })
  }

  for (const prefix of unknownPrefixes) {
    issues.push({ code: 'UNKNOWN_NAMESPACE', detail: `standardNames prefix "${prefix}" has no entry in namespaces` })
  }

  return {
    metadata: {
      nodeKey: ctx.nodeKey,
      version: ctx.version,
      receivedAt: ctx.receivedAt,
      contentHash: ctx.contentHash,
      node: {
        key: ctx.nodeKey,
        group: ctx.group,
        nodeId: ctx.nodeId,
        topic: ctx.topic,
        declaredId: n.id || undefined,
        name: n.name ?? '',
        serialNumber: n.serialNumber,
        firmwareVersion: n.firmwareVersion,
        url: n.url,
        location: location(n.location),
      },
      observers,
      parameters,
      namespaces,
      rawBytes: ctx.rawBytes,
    },
    issues,
  }
}

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER)

export function convertValue(v: RawValue): { value: ObsValue; kind: ValueKind; exact?: string } {
  const kind = (v.kind ?? 'emptyValue') as ValueKind
  switch (kind) {
    case 'floatValue':
    case 'doubleValue':
    case 'int32Value':
    case 'uint32Value':
      return { value: v[kind] ?? 0, kind }
    case 'int64Value':
    case 'uint64Value': {
      const s = v[kind] ?? '0'
      const big = BigInt(s)
      const unsafe = big > MAX_SAFE || big < -MAX_SAFE
      return { value: Number(s), kind, exact: unsafe ? s : undefined }
    }
    case 'stringValue':
      return { value: v.stringValue ?? '', kind }
    case 'boolValue':
      return { value: v.boolValue ?? false, kind }
    default:
      // emptyValue, or a Value with no member set: no value for that slot
      return { value: null, kind: 'emptyValue' }
  }
}

export interface DataContext {
  nodeKey: NodeKey
  messageId: string
  receivedAt: string
  /** Metadata in force at receipt; null if none is known. */
  metadata: MetadataVersion | null
  /** Clock tolerance for TIME_IN_FUTURE. */
  futureToleranceSeconds?: number
}

export interface DecodedData {
  observations: Observation[]
  issues: ConformanceIssue[]
  firstObsTime: string | null
  lastObsTime: string | null
  observationCount: number
  valueCount: number
  emptyValueCount: number
}

/**
 * Decode a data message against the metadata in force at receipt (positional values).
 * Without metadata, nothing is decoded (NO_METADATA); counts and times are still reported.
 */
export function decodeData(raw: RawData, ctx: DataContext): DecodedData {
  const issues: ConformanceIssue[] = []
  const observations: Observation[] = []
  const rawObs = raw.observations ?? []
  if (rawObs.length === 0) issues.push({ code: 'DATA_NO_OBSERVATIONS', detail: 'data message has no observations' })
  const tolerance = (ctx.futureToleranceSeconds ?? 60) * 1000
  const receivedMs = Date.parse(ctx.receivedAt)

  let first: number | null = null
  let last: number | null = null
  let valueCount = 0
  let emptyValueCount = 0
  let futureCount = 0
  let noValues = 0
  let unset = 0
  const unknownDefs = new Set<number>()

  const defs = new Map<number, Parameter[]>()
  for (const p of ctx.metadata?.parameters ?? []) {
    const list = defs.get(p.definitionId) ?? []
    list[p.valueIndex] = p
    defs.set(p.definitionId, list)
  }
  if (!ctx.metadata) issues.push({ code: 'NO_METADATA', detail: 'data received with no metadata known for this node' })

  rawObs.forEach((o, i) => {
    const time = timestampToIso(o.time)
    const values = o.values ?? []
    if (values.length === 0) noValues++
    unset += values.filter((v) => v.kind === undefined).length
    valueCount += values.length
    emptyValueCount += values.filter((v) => (v.kind ?? 'emptyValue') === 'emptyValue').length
    if (!time) {
      issues.push({ code: 'MISSING_TIME', detail: `observation ${i} has no time` })
      return
    }
    const ms = Date.parse(time)
    first = first === null ? ms : Math.min(first, ms)
    last = last === null ? ms : Math.max(last, ms)
    if (ms - receivedMs > tolerance) futureCount++

    if (!ctx.metadata) return
    const definitionId = o.parameterDefinitionId ?? 0
    const params = defs.get(definitionId)
    if (!params) {
      unknownDefs.add(definitionId)
      return
    }
    if (values.length !== params.length) {
      issues.push({
        code: 'VALUE_COUNT_MISMATCH',
        detail: `observation ${i} (definition ${definitionId}) has ${values.length} values, definition has ${params.length} parameters`,
      })
      return
    }
    values.forEach((v, idx) => {
      const p = params[idx]!
      const { value, kind, exact } = convertValue(v)
      observations.push({
        seriesKey: p.seriesKey,
        paramKey: p.key,
        nodeKey: ctx.nodeKey,
        definitionId,
        time,
        value,
        kind,
        exact,
        messageId: ctx.messageId,
        metadataVersion: ctx.metadata!.version,
        receivedAt: ctx.receivedAt,
      })
    })
  })

  for (const id of unknownDefs) {
    issues.push({ code: 'UNKNOWN_DEFINITION', detail: `parameterDefinitionId ${id} is not in metadata version ${ctx.metadata?.version}` })
  }
  if (noValues > 0) issues.push({ code: 'OBSERVATION_NO_VALUES', detail: `${noValues} observation(s) with no values` })
  if (unset > 0) issues.push({ code: 'VALUE_NOT_SET', detail: `${unset} value(s) set no type; use emptyValue for missing data` })
  if (futureCount > 0) {
    issues.push({ code: 'TIME_IN_FUTURE', detail: `${futureCount} observation(s) later than receipt time` })
  }

  return {
    observations,
    issues,
    firstObsTime: first === null ? null : new Date(first).toISOString(),
    lastObsTime: last === null ? null : new Date(last).toISOString(),
    observationCount: rawObs.length,
    valueCount,
    emptyValueCount,
  }
}
