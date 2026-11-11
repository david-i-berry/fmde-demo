// Display helpers. Times are UTC by default; pass utc=false for local time.

export function formatTime(iso: string | null | undefined, utc = true): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const s = utc
    ? d.toISOString().slice(0, 16).replace('T', ' ')
    : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  return utc ? `${s}Z` : s
}

const pad = (n: number) => String(n).padStart(2, '0')

/** 45 s, 12 min, 3 h 20 min, 2 d 4 h */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return '—'
  const s = Math.abs(seconds)
  if (s < 90) return `${Math.round(s)} s`
  if (s < 3600) return `${Math.round(s / 60)} min`
  if (s < 86400) {
    const h = Math.floor(s / 3600)
    const m = Math.round((s % 3600) / 60)
    return m ? `${h} h ${m} min` : `${h} h`
  }
  const d = Math.floor(s / 86400)
  const h = Math.round((s % 86400) / 3600)
  return h ? `${d} d ${h} h` : `${d} d`
}

export function formatAge(seconds: number | null | undefined): string {
  return seconds === null || seconds === undefined ? 'never' : `${formatDuration(seconds)} ago`
}

export function formatValue(v: number | string | boolean | null | undefined, unit?: string): string {
  if (v === null || v === undefined) return 'empty'
  const text = typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : String(v)
  return unit ? `${text} ${unit}` : text
}
