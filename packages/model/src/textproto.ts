// Protobuf text format rendering of decoded messages, annotated from metadata (node detail, inspector).
import type { RawFirstMileMessage, RawValue } from './proto'
import { timestampToIso } from './proto'
import type { MetadataVersion } from './types'

type Annotate = (path: string[], key: string, value: unknown) => string | undefined

function scalar(v: unknown): string {
  if (typeof v === 'string') return JSON.stringify(v)
  return String(v)
}

const ENUM_FIELDS = new Set(['cellMethod', 'referenceSurface'])
/** 64-bit integers arrive as strings from toObject(); text format writes them unquoted. */
const INT64_FIELDS = new Set(['seconds', 'int64Value', 'uint64Value'])
const fieldValue = (key: string, v: unknown) => (ENUM_FIELDS.has(key) || INT64_FIELDS.has(key) ? String(v) : scalar(v))
/** toObject() oneof discriminators and proto3-optional synthetic oneofs: not real fields. */
const isVirtual = (key: string) => key === 'content' || key === 'target' || key === 'kind' || key.startsWith('_')

function render(obj: Record<string, unknown>, indent: string, path: string[], annotate: Annotate, out: string[]): void {
  for (const [key, value] of Object.entries(obj)) {
    if (isVirtual(key) || value === undefined) continue
    if (Array.isArray(value)) {
      value.forEach((item, i) => emit(key, item, indent, [...path, `${key}[${i}]`], annotate, out))
    } else if (key === 'standardNames' || key === 'namespaces') {
      // map<string,string> renders as repeated key/value entries
      for (const [k, v] of Object.entries(value as Record<string, string>)) {
        out.push(`${indent}${key} { key: ${scalar(k)} value: ${scalar(v)} }`)
      }
    } else {
      emit(key, value, indent, [...path, key], annotate, out)
    }
  }
}

function emit(key: string, value: unknown, indent: string, path: string[], annotate: Annotate, out: string[]): void {
  const note = annotate(path, key, value)
  const comment = note ? `  # ${note}` : ''
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).filter(([k]) => !isVirtual(k))
    if (entries.length === 0) {
      out.push(`${indent}${key} {}${comment}`)
      return
    }
    if (key === 'values' || key === 'time') {
      // compact single-line form, as in the FMDE examples
      const inner = entries.map(([k, v]) => (v && typeof v === 'object' ? `${k} {}` : `${k}: ${fieldValue(k, v)}`)).join(' ')
      out.push(`${indent}${key} { ${inner} }${comment}`)
      return
    }
    out.push(`${indent}${key} {${comment}`)
    render(value as Record<string, unknown>, indent + '  ', path, annotate, out)
    out.push(`${indent}}`)
  } else {
    out.push(`${indent}${key}: ${fieldValue(key, value)}${comment}`)
  }
}

/** Render a decoded FirstMileMessage in protobuf text format; data values are annotated from metadata. */
export function toTextProto(msg: RawFirstMileMessage, metadata?: MetadataVersion | null): string {
  const byDef = new Map<number, MetadataVersion['parameters']>()
  for (const p of metadata?.parameters ?? []) {
    const list = byDef.get(p.definitionId) ?? []
    list[p.valueIndex] = p
    byDef.set(p.definitionId, list)
  }
  const observations = msg.data?.observations ?? []

  const annotate: Annotate = (path, key, value) => {
    if (key === 'time') return timestampToIso(value as { seconds?: string; nanos?: number }) ?? undefined
    const m = /^observations\[(\d+)]$/.exec(path[path.length - 2] ?? '')
    const v = /^values\[(\d+)]$/.exec(path[path.length - 1] ?? '')
    if (key === 'values' && m && v) {
      const obs = observations[Number(m[1])]
      const p = byDef.get(obs?.parameterDefinitionId ?? 0)?.[Number(v[1])]
      if (!p) return undefined
      const isEmpty = ((value as RawValue).kind ?? 'emptyValue') === 'emptyValue'
      return `${p.longName}${p.unit && !isEmpty ? ` [${p.unit}]` : ''}`
    }
    return undefined
  }

  const out: string[] = []
  render(msg as Record<string, unknown>, '', [], annotate, out)
  return out.join('\n')
}
