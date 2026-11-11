// FMDE Abstract Test Suite (standard/abstract_tests in wmo-im/fmde, main @ 693cc14, 22 Oct 2026),
// as executable checks. Each conformance code maps to the ATS test and requirement it evidences.
// Codes that no ATS test covers are hub checks, tied to the requirement (or schema comment) they enforce.
import type { RawMetadata } from './proto'
import unitsSnapshot from './generated/wmo-units.json'
import type { ConformanceCode, ConformanceIssue } from './types'

export const ATS_SOURCE = 'https://github.com/wmo-im/fmde/tree/main/standard/abstract_tests'
export const STANDARD_URL = 'https://wmo-im.github.io/fmde/standard/fmde-DRAFT.html'

export type AtsClass = 'message-encoding' | 'parameter-standard-names' | 'transmission'

/**
 * - automated: run by NODAL on every message
 * - network: needs an HTTP request to an external URI (not run in the browser; CORS)
 * - not-applicable: the ATS states the requirement is not applicable to ATS testing
 */
export type AtsMode = 'automated' | 'network' | 'not-applicable'

export interface AtsTest {
  /** Conformance test label, e.g. /conf/message-encoding/node */
  id: string
  requirement: string
  cls: AtsClass
  title: string
  purpose: string
  /** What the test examines. */
  target: 'metadata' | 'data' | 'topic' | 'any'
  mode: AtsMode
  /** Where NODAL's implementation deliberately differs from the ATS text, and why. */
  note?: string
}

const t = (cls: AtsClass, name: string, title: string, purpose: string, target: AtsTest['target'], mode: AtsMode, note?: string): AtsTest => ({
  id: `/conf/${cls}/${name}`,
  requirement: `/req/${cls}/${name}`,
  cls,
  title,
  purpose,
  target,
  mode,
  note,
})

export const ATS_TESTS: AtsTest[] = [
  t('message-encoding', 'encoding', 'Encoding', 'The message is encoded as Protobuf and its root field is data or metadata.', 'any', 'automated'),
  t('message-encoding', 'location', 'Location', 'Every Location has heightMetres and a referenceSurface from the ReferenceSurface enumeration.', 'metadata', 'automated',
    'heightMetres is a proto3 scalar, so presence cannot be told from 0; only referenceSurface is checked.'),
  t('message-encoding', 'metadata', 'Metadata', 'Metadata has a node, at least one observer, at least one parameter definition and a non-empty namespaces map.', 'metadata', 'automated',
    'The ATS requires ≥1 observer and ≥1 namespace, but /req/message-encoding/metadata B allows zero observers and /per/parameter-standard-names/declaration allows empty namespaces when no standard names are used; those cases are warnings.'),
  t('message-encoding', 'node', 'Node', 'Metadata has a valid node (with a name).', 'metadata', 'automated'),
  t('message-encoding', 'observer_device', 'Observer device', 'Every observer device is valid (id and name).', 'metadata', 'automated'),
  t('message-encoding', 'parameter_definition', 'Parameter definition', 'Every parameter definition is valid (id, description, ≥1 parameter).', 'metadata', 'automated'),
  t('message-encoding', 'parameter', 'Parameter', 'Every parameter has a longName, a unit from WMO Code Table C-6 or the First Mile unit registry, and a cellPeriodSeconds consistent with its cellMethod.', 'metadata', 'automated',
    'The First Mile unit registry (codes.wmo.int/fmde/unit) is empty, so units are checked against a C-6 snapshot (notation or WMO abbreviation).'),
  t('message-encoding', 'device_ref', 'DeviceRef', 'Every parameter has a device that is either the node or a declared observer.', 'metadata', 'automated'),
  t('message-encoding', 'data', 'Data', 'Data has at least one observation.', 'data', 'automated'),
  t('message-encoding', 'observation', 'Observation', 'Every observation has one or more values.', 'data', 'automated'),
  t('message-encoding', 'value', 'Value', 'Every value sets one of the Value types.', 'data', 'automated'),
  t('parameter-standard-names', 'assignment', 'Standard name assignment', 'Every standardNames key is declared in the namespaces map.', 'metadata', 'automated'),
  t('parameter-standard-names', 'declaration', 'Namespace declaration', 'Namespace prefixes are non-empty alphanumeric/underscore; URIs resolve over HTTP.', 'metadata', 'automated',
    'The prefix is checked on every metadata message; URI resolution needs an HTTP request and is not run in the browser.'),
  t('parameter-standard-names', 'hierarchy', 'Standard name hierarchy', 'Every namespace URI is HTTP accessible without authentication.', 'metadata', 'network'),
  t('transmission', 'conventions', 'Topic conventions', 'The topic is lowercase ASCII (T.50) without dots.', 'topic', 'automated'),
  t('transmission', 'group_node_id', 'Group and node id', 'group-id and node-id are non-empty lowercase ASCII alphanumerics and hyphens, not starting or ending with a hyphen.', 'topic', 'automated'),
  t('transmission', 'management', 'Topic hierarchy management', 'The First Mile topic hierarchy is properly managed.', 'any', 'not-applicable'),
  t('transmission', 'protocol', 'Protocol', 'Messages are transmitted using MQTT.', 'any', 'not-applicable'),
  t('transmission', 'publishing', 'Publishing', 'Messages are published using MQTT.', 'any', 'not-applicable'),
  t('transmission', 'versioning', 'Topic hierarchy versioning', 'The First Mile topic hierarchy is properly versioned.', 'any', 'not-applicable'),
]

export type Severity = 'error' | 'warning'

export interface CodeInfo {
  /** ATS test this code evidences, if any. */
  test?: string
  /** Requirement (or schema rule) violated. */
  requirement: string
  severity: Severity
  description: string
}

/** CF standard names: prefix + name resolves to the term, e.g. …/standard_name/air_temperature/. */
export const CF_STANDARD_NAME_ROOT = 'https://vocab.nerc.ac.uk/standard_name/'

export const CODE_INFO: Record<ConformanceCode, CodeInfo> = {
  DECODE_ERROR: { test: '/conf/message-encoding/encoding', requirement: '/req/message-encoding/encoding', severity: 'error', description: 'The payload is not a valid FirstMileMessage Protobuf message' },
  EMPTY_MESSAGE: { test: '/conf/message-encoding/encoding', requirement: '/req/message-encoding/first_mile_message B', severity: 'error', description: 'The FirstMileMessage declares neither data nor metadata' },
  LOCATION_NO_REFERENCE_SURFACE: { test: '/conf/message-encoding/location', requirement: '/req/message-encoding/location B', severity: 'error', description: 'A Location has no referenceSurface' },
  METADATA_NO_NODE: { test: '/conf/message-encoding/metadata', requirement: '/req/message-encoding/metadata A', severity: 'error', description: 'Metadata has no node' },
  METADATA_NO_OBSERVERS: { test: '/conf/message-encoding/metadata', requirement: '/req/message-encoding/metadata B', severity: 'warning', description: 'Metadata has no observers (the ATS requires one; the requirement allows zero)' },
  METADATA_NO_DEFINITIONS: { test: '/conf/message-encoding/metadata', requirement: '/req/message-encoding/metadata C', severity: 'error', description: 'Metadata has no parameter definitions' },
  METADATA_NO_NAMESPACES: { test: '/conf/message-encoding/metadata', requirement: '/req/message-encoding/metadata D', severity: 'warning', description: 'Metadata has an empty namespaces map (the ATS requires one mapping; permitted when no standard names are used)' },
  NODE_NO_NAME: { test: '/conf/message-encoding/node', requirement: '/req/message-encoding/node A', severity: 'error', description: 'The node has no name' },
  OBSERVER_NO_NAME: { test: '/conf/message-encoding/observer_device', requirement: '/req/message-encoding/observer_device B', severity: 'error', description: 'An observer device has no name' },
  DUPLICATE_OBSERVER_ID: { test: '/conf/message-encoding/observer_device', requirement: '/req/message-encoding/observer_device A', severity: 'error', description: 'Two observer devices share an id' },
  DEFINITION_NO_DESCRIPTION: { test: '/conf/message-encoding/parameter_definition', requirement: '/req/message-encoding/parameter_definition B', severity: 'error', description: 'A parameter definition has no description' },
  DEFINITION_NO_PARAMETERS: { test: '/conf/message-encoding/parameter_definition', requirement: '/req/message-encoding/parameter_definition C', severity: 'error', description: 'A parameter definition has no parameters' },
  DUPLICATE_DEFINITION_ID: { test: '/conf/message-encoding/parameter_definition', requirement: '/req/message-encoding/parameter_definition A', severity: 'error', description: 'Two parameter definitions share an id' },
  PARAMETER_NO_LONG_NAME: { test: '/conf/message-encoding/parameter', requirement: '/req/message-encoding/parameter A', severity: 'error', description: 'A parameter has no longName' },
  UNIT_NOT_IN_CODELIST: { test: '/conf/message-encoding/parameter', requirement: '/req/message-encoding/parameter B', severity: 'error', description: 'A unit is not in WMO Code Table C-6 or the First Mile unit registry' },
  CELL_METHOD_UNSPECIFIED: { test: '/conf/message-encoding/parameter', requirement: '/req/message-encoding/parameter E', severity: 'error', description: 'A parameter has no cellMethod' },
  CELL_PERIOD_INCONSISTENT: { test: '/conf/message-encoding/parameter', requirement: '/req/message-encoding/parameter G', severity: 'error', description: 'cellPeriodSeconds must be 0 for POINT and greater than 0 for other cell methods' },
  DEVICE_REF_MISSING: { test: '/conf/message-encoding/device_ref', requirement: '/req/message-encoding/device_ref A', severity: 'error', description: 'A parameter has no device (node or observerId)' },
  UNKNOWN_OBSERVER: { test: '/conf/message-encoding/device_ref', requirement: '/req/message-encoding/device_ref C', severity: 'error', description: 'A parameter refers to an observer device the metadata does not declare' },
  DATA_NO_OBSERVATIONS: { test: '/conf/message-encoding/data', requirement: '/req/message-encoding/data A', severity: 'error', description: 'A data message has no observations' },
  OBSERVATION_NO_VALUES: { test: '/conf/message-encoding/observation', requirement: '/req/message-encoding/observation C', severity: 'error', description: 'An observation has no values' },
  MISSING_TIME: { test: '/conf/message-encoding/observation', requirement: '/req/message-encoding/observation B', severity: 'error', description: 'An observation has no time' },
  VALUE_NOT_SET: { test: '/conf/message-encoding/value', requirement: '/req/message-encoding/value A', severity: 'error', description: 'A Value sets none of its types (use emptyValue for missing data)' },
  UNKNOWN_NAMESPACE: { test: '/conf/parameter-standard-names/assignment', requirement: '/req/parameter-standard-names/assignment A', severity: 'error', description: 'A standard name uses a prefix the namespaces map does not declare' },
  NAMESPACE_PREFIX_INVALID: { test: '/conf/parameter-standard-names/declaration', requirement: '/req/parameter-standard-names/declaration C', severity: 'error', description: 'A namespace prefix is empty or has characters other than alphanumerics and underscores' },
  TOPIC_CONVENTIONS: { test: '/conf/transmission/conventions', requirement: '/req/transmission/conventions', severity: 'error', description: 'The topic is not lowercase ASCII without dots' },
  GROUP_NODE_ID_INVALID: { test: '/conf/transmission/group_node_id', requirement: '/req/transmission/group_node_id', severity: 'error', description: 'The group-id or node-id is not lowercase alphanumerics and hyphens' },
  // hub checks: requirements without an ATS test, or operational heuristics
  BAD_TOPIC: { requirement: '/req/transmission/publishing A', severity: 'error', description: 'The topic is not in the First Mile topic hierarchy (firstmile/a/<group>/<node>)' },
  NO_METADATA: { requirement: '/req/transmission/publishing B', severity: 'error', description: 'Data arrived before any metadata for the node' },
  METADATA_NOT_RETAINED: { requirement: '/req/transmission/publishing C', severity: 'error', description: 'A metadata message was published without the retained flag' },
  DATA_RETAINED: { requirement: 'schema: FirstMileMessage.data MUST NOT be retained', severity: 'error', description: 'A data message was published with the retained flag' },
  UNKNOWN_DEFINITION: { requirement: '/req/message-encoding/observation A', severity: 'error', description: 'An observation refers to a parameter definition the metadata does not declare' },
  VALUE_COUNT_MISMATCH: { requirement: '/req/message-encoding/parameter H', severity: 'error', description: 'An observation has a different number of values than its definition has parameters; it cannot be decoded' },
  TIME_IN_FUTURE: { requirement: '/req/message-encoding/observation B (hub check)', severity: 'warning', description: 'Observation time is later than receipt: the logger clock or time zone is probably wrong' },
  NODE_ID_MISMATCH: { requirement: 'hub check (Node.id is under discussion in /req/message-encoding/node)', severity: 'warning', description: 'Node.id differs from the node-id level of the topic' },
  METADATA_CLEARED: { requirement: 'hub check', severity: 'warning', description: 'A zero-length retained message deleted the retained metadata' },
  CF_NAMESPACE_URI: {
    requirement: 'hub check',
    severity: 'warning',
    description: `A CF standard-name namespace does not map to the standard-name root, ${CF_STANDARD_NAME_ROOT} (prefix + name must resolve to the term)`,
  },
  POC1_LEGACY_ENCODING: {
    test: '/conf/message-encoding/encoding',
    requirement: '/req/message-encoding/first_mile_message A; /req/message-encoding/encoding',
    severity: 'warning',
    description: 'Legacy POC1 payload: a bare Metadata/Data message without the FirstMileMessage envelope, Node in the numbering before 16 Jun 2026 (no name field)',
  },
  POC1_TOPIC_LEVEL: { requirement: 'POC1 topic convention', severity: 'warning', description: 'POC1 topic uses "meta" where the convention is "metadata"' },
}

/** On the legacy POC1 hierarchy, checks its conventions predate are warnings, not errors. */
const POC1_TOLERATED = new Set<ConformanceCode>(['TOPIC_CONVENTIONS', 'GROUP_NODE_ID_INVALID'])

export function severityFor(code: ConformanceCode, profile: 'a' | 'poc1' = 'a'): Severity {
  return profile === 'poc1' && POC1_TOLERATED.has(code) ? 'warning' : CODE_INFO[code].severity
}

export function atsTest(id: string): AtsTest | undefined {
  return ATS_TESTS.find((x) => x.id === id)
}

/** Link to the test in the published draft standard. */
export function atsLink(test: AtsTest): string {
  return `${STANDARD_URL}#ats_${test.cls}-${test.id.split('/').pop()}`
}

// --- checks ------------------------------------------------------------------------------------

const UNIT_SYMBOLS = new Set(
  unitsSnapshot.units.flatMap((u) => [u.notation, ...(u.abbreviation ? [u.abbreviation, normaliseDegree(u.abbreviation)] : [])]),
)
function normaliseDegree(s: string): string {
  return s.replace(/˚/g, '°') // WMO abbreviations use ˚ (ring above) where most text uses ° (degree sign)
}

export function isKnownUnit(unit: string): boolean {
  return UNIT_SYMBOLS.has(unit) || UNIT_SYMBOLS.has(normaliseDegree(unit))
}

const ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/

/** A namespace meant for CF standard names: prefix "cf" (any case), or a NERC vocabulary URI for them (standard_name or collection P07). */
export function isCfNamespace(prefix: string, uri: string): boolean {
  return prefix.toLowerCase() === 'cf' || /vocab\.nerc\.ac\.uk\/(standard_name|collection\/P07)\b/i.test(uri)
}

/** /conf/transmission/conventions and /conf/transmission/group_node_id */
export function checkTopic(topic: string, group: string, nodeId: string): ConformanceIssue[] {
  const issues: ConformanceIssue[] = []
  // eslint-disable-next-line no-control-regex
  if (topic !== topic.toLowerCase() || !/^[\x00-\x7f]*$/.test(topic) || topic.includes('.')) {
    issues.push({ code: 'TOPIC_CONVENTIONS', detail: `topic "${topic}" must be lowercase ASCII without dots` })
  }
  for (const [what, id] of [['group-id', group], ['node-id', nodeId]] as const) {
    if (!ID_PATTERN.test(id)) issues.push({ code: 'GROUP_NODE_ID_INVALID', detail: `${what} "${id}" must be lowercase alphanumerics and hyphens, not starting or ending with a hyphen` })
  }
  return issues
}

/** Metadata-level ATS checks not covered during normalisation (see normaliseMetadata). */
export function checkMetadata(raw: RawMetadata): ConformanceIssue[] {
  const issues: ConformanceIssue[] = []
  const add = (code: ConformanceCode, detail: string) => issues.push({ code, detail })

  if (!raw.node) add('METADATA_NO_NODE', 'metadata has no node')
  else if (!raw.node.name) add('NODE_NO_NAME', 'node has no name')
  if (!raw.observers?.length) add('METADATA_NO_OBSERVERS', 'metadata declares no observers')
  if (!raw.parameterDefinitions?.length) add('METADATA_NO_DEFINITIONS', 'metadata declares no parameter definitions')
  const namespaces = raw.namespaces ?? {}
  if (Object.keys(namespaces).length === 0) add('METADATA_NO_NAMESPACES', 'namespaces map is empty')
  for (const [prefix, uri] of Object.entries(namespaces)) {
    if (!/^[A-Za-z0-9_]+$/.test(prefix)) add('NAMESPACE_PREFIX_INVALID', `namespace prefix "${prefix}"`)
    if (isCfNamespace(prefix, uri) && uri !== CF_STANDARD_NAME_ROOT) add('CF_NAMESPACE_URI', `namespace "${prefix}" is "${uri}", expected "${CF_STANDARD_NAME_ROOT}"`)
  }

  const locations = [['node', raw.node?.location], ...(raw.observers ?? []).map((o) => [`observer ${o.id ?? 0}`, o.location] as const)] as const
  for (const [where, loc] of locations) {
    if (loc && (!loc.referenceSurface || loc.referenceSurface === 'REFERENCE_SURFACE_UNSPECIFIED')) {
      add('LOCATION_NO_REFERENCE_SURFACE', `${where} location has no referenceSurface`)
    }
  }

  const observerIds = new Set<number>()
  for (const o of raw.observers ?? []) {
    if (!o.name) add('OBSERVER_NO_NAME', `observer ${o.id ?? 0} has no name`)
    if (observerIds.has(o.id ?? 0)) add('DUPLICATE_OBSERVER_ID', `observer id ${o.id ?? 0} appears more than once`)
    observerIds.add(o.id ?? 0)
  }

  const badUnits = new Set<string>()
  for (const def of raw.parameterDefinitions ?? []) {
    const id = def.id ?? 0
    if (!def.description) add('DEFINITION_NO_DESCRIPTION', `definition ${id} has no description`)
    if (!def.parameters?.length) add('DEFINITION_NO_PARAMETERS', `definition ${id} has no parameters`)
    ;(def.parameters ?? []).forEach((p, i) => {
      const where = `definition ${id}[${i}]${p.longName ? ` (${p.longName})` : ''}`
      if (!p.longName) add('PARAMETER_NO_LONG_NAME', `${where} has no longName`)
      if (!p.unit || !isKnownUnit(p.unit)) badUnits.add(p.unit ?? '')
      const method = p.cellMethod && p.cellMethod !== 'CELL_METHOD_UNSPECIFIED' ? p.cellMethod : null
      const period = p.cellPeriodSeconds ?? 0
      if (!method) add('CELL_METHOD_UNSPECIFIED', `${where} has no cellMethod`)
      else if (method === 'POINT' ? period !== 0 : period <= 0) {
        add('CELL_PERIOD_INCONSISTENT', `${where}: ${method} with cellPeriodSeconds ${period}`)
      }
      if (p.device?.observerId === undefined && p.device?.node === undefined) add('DEVICE_REF_MISSING', `${where} has no device`)
    })
  }
  for (const u of badUnits) add('UNIT_NOT_IN_CODELIST', u ? `unit "${u}" is not in WMO Code Table C-6` : 'a parameter has no unit')
  return issues
}

export type AtsStatus = 'pass' | 'fail' | 'warning' | 'not-run' | 'network' | 'not-applicable'

export interface AtsResult {
  test: AtsTest
  status: AtsStatus
  issues: ConformanceIssue[]
}

/**
 * Evaluate the ATS for one node: metadata and topic tests from the current metadata, data tests
 * from the issues recorded on data messages (`dataIssues`) over `dataMessages` messages.
 */
export function evaluateAts(input: {
  topic: { topic: string; group: string; nodeId: string }
  metadata: RawMetadata | null
  /** Issues from normalisation of the current metadata (UNKNOWN_OBSERVER, UNKNOWN_NAMESPACE, …). */
  metadataIssues?: ConformanceIssue[]
  dataIssues: ConformanceIssue[]
  dataMessages: number
}): AtsResult[] {
  const topicIssues = checkTopic(input.topic.topic, input.topic.group, input.topic.nodeId)
  const metaIssues = input.metadata ? [...checkMetadata(input.metadata), ...(input.metadataIssues ?? [])] : []
  const all = [...topicIssues, ...metaIssues, ...input.dataIssues]

  return ATS_TESTS.map((test) => {
    if (test.mode === 'not-applicable') return { test, status: 'not-applicable', issues: [] }
    if (test.mode === 'network') return { test, status: 'network', issues: [] }
    const issues = all.filter((i) => CODE_INFO[i.code]?.test === test.id)
    const ran =
      test.target === 'topic' ||
      (test.target === 'metadata' && input.metadata !== null) ||
      (test.target === 'data' && input.dataMessages > 0) ||
      (test.target === 'any' && (input.metadata !== null || input.dataMessages > 0))
    if (!ran) return { test, status: 'not-run', issues }
    if (issues.some((i) => CODE_INFO[i.code].severity === 'error')) return { test, status: 'fail', issues }
    return { test, status: issues.length ? 'warning' : 'pass', issues }
  })
}
