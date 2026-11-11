// Site view: building models, position from FMDE parameters, floor from pressure.
// Position is data, not metadata: a moving node reports latitude, longitude and air_pressure as
// ordinary parameters; the metadata Location is the nominal position and the fallback.
import type { MetadataVersion, Parameter, SeriesKey } from './types'

export type Ring = [number, number][]

export interface SiteLevel {
  label: string
  name: string
  /** floor height, metres relative to ground level 0 */
  z: number
  /** key into SiteBuilding.outlines */
  outline: string
}

/** data/sites/<site>.building.json. Local frame: x = metres east, y = metres south of origin. */
export interface SiteBuilding {
  id: string
  name: string
  origin: { lat: number; lon: number; note?: string }
  attribution: string
  heights: Record<string, number>
  groundLevel: string
  /** elevation of the ground level (z = 0), m above MSL: converts MSL heights into the building frame */
  elevationMetres?: number
  /** pressure reference outside the network, used when no reference node is configured or on site */
  pressureReference?: ExternalPressureReference
  levels: SiteLevel[]
  /** named rings, plus auxiliary arrays (e.g. towerBaseOnPodium flags, liftCars rings) */
  outlines: Record<string, unknown>
  features: Record<string, unknown>
}

/** An official station's station-level pressure (QFE), e.g. MeteoSwiss open data, as the site's barometer. */
export interface ExternalPressureReference {
  provider: 'meteoswiss'
  /** station abbreviation, e.g. GVE */
  station: string
  name: string
  /** barometer height, m above MSL */
  heightMetres: number
  /** 10-minute data, CSV (MeteoSwiss OGD SwissMetNet "t_now" file) */
  url: string
  attribution: string
}

/** A Location's height in the building frame (m above the ground level): MSL heights need the building's elevation. */
export function heightInBuilding(b: SiteBuilding, loc: { heightMetres?: number; referenceSurface?: string } | undefined): number {
  const h = loc?.heightMetres ?? 0
  return loc?.referenceSurface === 'MSL' && b.elevationMetres !== undefined ? h - b.elevationMetres : h
}

/**
 * MeteoSwiss OGD SwissMetNet 10-minute CSV → reference samples: station pressure (prestas0, QFE,
 * hPa) and 2 m air temperature (tre200s0, °C). Timestamps ("30.10.2026 14:10") are UTC.
 */
export function parseMeteoSwissCsv(text: string): ReferenceSample[] {
  const [head, ...rows] = text.trim().split(/\r?\n/)
  const cols = (head ?? '').split(';')
  const iTime = cols.indexOf('reference_timestamp')
  const iP = cols.indexOf('prestas0')
  const iT = cols.indexOf('tre200s0')
  if (iTime < 0 || iP < 0) return []
  return rows.flatMap((r) => {
    const c = r.split(';')
    const m = /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2})$/.exec(c[iTime] ?? '')
    const p = Number(c[iP])
    if (!m || !c[iP] || !Number.isFinite(p)) return []
    const t = iT >= 0 && c[iT] ? Number(c[iT]) : NaN
    const time = new Date(Date.UTC(+m[3]!, +m[2]! - 1, +m[1]!, +m[4]!, +m[5]!)).toISOString()
    return [{ time, pressure: p, ...(Number.isFinite(t) ? { temp: t } : {}) }]
  })
}

/**
 * Carry a reference forward past its last sample, along its trend over the last `trendSeconds`, in
 * `stepSeconds` steps up to `untilMs` (at most `maxSeconds` ahead). Official data arrives 10-20 min
 * late; pressure trends of ~0.5 hPa/h make that ~1 m of height, so the newest samples still get a floor.
 */
export function extendReference(samples: ReferenceSample[], untilMs: number, o: { stepSeconds?: number; trendSeconds?: number; maxSeconds?: number } = {}): ReferenceSample[] {
  const sorted = [...samples].sort((a, c) => Date.parse(a.time) - Date.parse(c.time))
  const last = sorted.at(-1)
  if (!last) return sorted
  const tLast = Date.parse(last.time)
  const from = sorted.find((s) => Date.parse(s.time) >= tLast - (o.trendSeconds ?? 3600) * 1000) ?? last
  const dt = (tLast - Date.parse(from.time)) / 1000
  const slope = dt > 0 ? (last.pressure - from.pressure) / dt : 0 // hPa per second
  const step = (o.stepSeconds ?? 600) * 1000
  const end = Math.min(untilMs, tLast + (o.maxSeconds ?? 3600) * 1000)
  const out = [...sorted]
  for (let t = tLast + step; t <= end + step - 1; t += step) {
    const tt = Math.min(t, end)
    out.push({ time: new Date(tt).toISOString(), pressure: last.pressure + (slope * (tt - tLast)) / 1000, temp: last.temp })
    if (tt === end) break
  }
  return out
}

const isRing = (v: unknown): v is Ring =>
  Array.isArray(v) && v.length >= 3 && v.every((p) => Array.isArray(p) && p.length === 2 && typeof p[0] === 'number')

export function ring(b: SiteBuilding, name: string): Ring | undefined {
  const r = b.outlines[name]
  return isRing(r) ? r : undefined
}

export function rings(b: SiteBuilding, name: string): Ring[] {
  const r = b.outlines[name]
  return Array.isArray(r) && r.every(isRing) ? (r as Ring[]) : []
}

// --- geography --------------------------------------------------------------------------------

const M_PER_DEG = 111320

/** Equirectangular around the origin; fine at building scale. x east, y south (three.js: scene z = y). */
export function toLocal(origin: { lat: number; lon: number }, lat: number, lon: number): { x: number; y: number } {
  return {
    x: (lon - origin.lon) * M_PER_DEG * Math.cos((origin.lat * Math.PI) / 180),
    y: -(lat - origin.lat) * M_PER_DEG,
  }
}

export function toLatLon(origin: { lat: number; lon: number }, x: number, y: number): { lat: number; lon: number } {
  return {
    lat: origin.lat - y / M_PER_DEG,
    lon: origin.lon + x / (M_PER_DEG * Math.cos((origin.lat * Math.PI) / 180)),
  }
}

export function pointInRing(x: number, y: number, r: Ring): boolean {
  let inside = false
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i]!
    const [xj, yj] = r[j]!
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Bounding box of every level outline, in local metres. */
export function siteBounds(b: SiteBuilding): { x0: number; x1: number; y0: number; y1: number } {
  const pts = [...new Set(b.levels.map((l) => l.outline))].flatMap((n) => ring(b, n) ?? [])
  return pts.reduce((a, [x, y]) => ({ x0: Math.min(a.x0, x), x1: Math.max(a.x1, x), y0: Math.min(a.y0, y), y1: Math.max(a.y1, y) }), {
    x0: Infinity,
    x1: -Infinity,
    y0: Infinity,
    y1: -Infinity,
  })
}

/** Is the position within the site (its outlines' bounding box plus a margin)? */
export function siteContains(b: SiteBuilding, lat: number, lon: number, marginMetres = 30): boolean {
  const { x, y } = toLocal(b.origin, lat, lon)
  const bb = siteBounds(b)
  return x >= bb.x0 - marginMetres && x <= bb.x1 + marginMetres && y >= bb.y0 - marginMetres && y <= bb.y1 + marginMetres
}

export function siteForLocation(sites: SiteBuilding[], lat?: number, lon?: number): SiteBuilding | null {
  if (lat === undefined || lon === undefined) return null
  return sites.find((s) => siteContains(s, lat, lon)) ?? null
}

/** The ground outline as a lon/lat polygon, for drawing the site on the map. */
export function siteFootprint(b: SiteBuilding): [number, number][] {
  const ground = b.levels.find((l) => l.label === b.groundLevel)
  const r = (ground && ring(b, ground.outline)) ?? ring(b, b.levels[0]?.outline ?? '') ?? []
  return r.map(([x, y]) => {
    const p = toLatLon(b.origin, x, y)
    return [p.lon, p.lat]
  })
}

// --- floor from pressure (§14.2) ----------------------------------------------------------------

export const R_DRY_AIR = 287.05 // J kg-1 K-1
export const G0 = 9.80665 // m s-2

/** Scale height H = R·T/g; about 8.6 km at 20 °C. */
export function scaleHeight(tempC = 20): number {
  return (R_DRY_AIR * (tempC + 273.15)) / G0
}

/** Height of the node's barometer above the reference barometer: Δz = H · ln(p_ref / p_node). */
export function heightDifference(pRefHpa: number, pNodeHpa: number, tempC = 20): number {
  return scaleHeight(tempC) * Math.log(pRefHpa / pNodeHpa)
}

export function nearestLevel(b: SiteBuilding, z: number): SiteLevel {
  return b.levels.reduce((best, l) => (Math.abs(l.z - z) < Math.abs(best.z - z) ? l : best), b.levels[0]!)
}

// --- position parameters ------------------------------------------------------------------------

export interface PositionParameters {
  latitude?: Parameter
  longitude?: Parameter
  pressure?: Parameter
  height?: Parameter
  temperature?: Parameter
  hdop?: Parameter
}

const byStandardName = (md: MetadataVersion, names: string[]) =>
  md.parameters.find((p) => p.cellMethod === 'POINT' && Object.values(p.standardNames).some((n) => names.includes(n)))

/** Position-related parameters of a node, found by standard name (HDOP has none: by long name). */
export function positionParameters(md: MetadataVersion): PositionParameters {
  return {
    latitude: byStandardName(md, ['latitude']),
    longitude: byStandardName(md, ['longitude']),
    pressure: byStandardName(md, ['air_pressure']),
    height: byStandardName(md, ['height', 'height_above_mean_sea_level', 'altitude']),
    temperature: byStandardName(md, ['air_temperature']),
    hdop: md.parameters.find((p) => /hdop|dilution of precision/i.test(p.longName)),
  }
}

/** A node that reports its position (latitude and longitude parameters). */
export const isMobile = (md: MetadataVersion) => {
  const p = positionParameters(md)
  return !!(p.latitude && p.longitude)
}

/** A pressure reference: a fixed node (no position parameters) with a barometer. */
export const isPressureReference = (md: MetadataVersion) => !isMobile(md) && !!positionParameters(md).pressure

export function positionSeries(md: MetadataVersion): SeriesKey[] {
  return Object.values(positionParameters(md))
    .filter((p): p is Parameter => !!p)
    .map((p) => p.seriesKey)
}

// --- track --------------------------------------------------------------------------------------

/** One observation time of a node: whichever position quantities it reported. */
export interface PositionSample {
  time: string
  lat?: number
  lon?: number
  pressure?: number
  height?: number
  temp?: number
  hdop?: number
}

export interface ReferenceSample {
  time: string
  pressure: number
  temp?: number
}

export interface SitePosition {
  time: string
  /** local metres (smoothed) */
  x: number
  y: number
  /** estimated floor height (smoothed), metres relative to ground 0 */
  z: number
  level: SiteLevel
  /** barometer height above ground (unsmoothed), when derived from pressure */
  sensorHeight?: number
  lat?: number
  lon?: number
  hdop?: number
  pressure?: number
  refPressure?: number
  /** how z was obtained */
  zSource: 'pressure' | 'height' | 'nominal'
  /** how x/y were obtained: a GPS fix, the last fix carried forward (e.g. no fix underground), or nominal */
  xySource: 'gps' | 'last' | 'nominal'
}

export interface TrackOptions {
  /** reference barometer height above ground level 0 (its metadata Location.heightMetres) */
  refHeight?: number
  /** carried/mounted height of the node's barometer above its floor */
  sensorAboveFloor?: number
  /** nominal position (metadata Location), used where the node reports none */
  nominal?: { lat?: number; lon?: number; heightMetres?: number }
  /** exponential smoothing factors; 1 = none */
  alphaXY?: number
  alphaZ?: number
  /** a reference reading further away in time than this is not used */
  maxRefGapSeconds?: number
}

/**
 * Turn a node's samples into positions in the building (§14.2): x/y from GPS, z from pressure
 * against the reference node (nearest reading in time), smoothed before snapping to a level.
 * The reference cancels weather changes; absolute pressure alone (±9 m) cannot resolve floors.
 */
export function siteTrack(b: SiteBuilding, samples: PositionSample[], reference: ReferenceSample[], o: TrackOptions = {}): SitePosition[] {
  const refHeight = o.refHeight ?? 0
  const above = o.sensorAboveFloor ?? 1.1
  const ax = o.alphaXY ?? 0.45
  const az = o.alphaZ ?? 0.55
  const maxGap = (o.maxRefGapSeconds ?? 600) * 1000
  const refs = [...reference].sort((a, c) => Date.parse(a.time) - Date.parse(c.time))
  const refTimes = refs.map((r) => Date.parse(r.time))
  const nominalXY = o.nominal?.lat !== undefined && o.nominal.lon !== undefined ? toLocal(b.origin, o.nominal.lat, o.nominal.lon) : { x: 0, y: 0 }

  const nearestRef = (t: number): ReferenceSample | null => {
    let lo = 0
    let hi = refTimes.length - 1
    if (hi < 0) return null
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (refTimes[mid]! < t) lo = mid + 1
      else hi = mid
    }
    const cands = [lo - 1, lo].filter((i) => i >= 0 && i < refTimes.length)
    const best = cands.reduce((a, c) => (Math.abs(refTimes[c]! - t) < Math.abs(refTimes[a]! - t) ? c : a))
    return Math.abs(refTimes[best]! - t) <= maxGap ? refs[best]! : null
  }

  const out: SitePosition[] = []
  let sx: number | null = null
  let sy: number | null = null
  let sz: number | null = null
  for (const s of [...samples].sort((a, c) => Date.parse(a.time) - Date.parse(c.time))) {
    const t = Date.parse(s.time)
    const gps = s.lat !== undefined && s.lon !== undefined
    const p: { x: number; y: number } = gps ? toLocal(b.origin, s.lat!, s.lon!) : sx !== null && sy !== null ? { x: sx, y: sy } : nominalXY

    let z: number
    let zSource: SitePosition['zSource']
    let sensorHeight: number | undefined
    const ref = s.pressure !== undefined ? nearestRef(t) : null
    if (ref && s.pressure !== undefined) {
      const temp = ref.temp ?? s.temp ?? 20
      sensorHeight = refHeight + heightDifference(ref.pressure, s.pressure, temp)
      z = sensorHeight - above
      zSource = 'pressure'
    } else if (s.height !== undefined) {
      z = s.height - above
      zSource = 'height'
    } else {
      z = (o.nominal?.heightMetres ?? above) - above
      zSource = 'nominal'
    }

    const hadPosition = sx !== null
    const nx: number = sx === null ? p.x : sx + (p.x - sx) * ax
    const ny: number = sy === null ? p.y : sy + (p.y - sy) * ax
    const nz: number = sz === null ? z : sz + (z - sz) * az
    sx = nx
    sy = ny
    sz = nz
    out.push({
      time: s.time,
      x: nx,
      y: ny,
      z: nz,
      level: nearestLevel(b, nz),
      sensorHeight,
      lat: s.lat,
      lon: s.lon,
      hdop: s.hdop,
      pressure: s.pressure,
      refPressure: ref?.pressure,
      zSource,
      xySource: gps ? 'gps' : hadPosition ? 'last' : 'nominal',
    })
  }
  return out
}

/** One stored observation of a position series (null = emptyValue). */
export interface SeriesRow {
  seriesKey: SeriesKey
  time: string
  value: number | null
}

/** Group a node's position-series observations by time into samples. */
export function positionSamples(params: PositionParameters, rows: SeriesRow[]): PositionSample[] {
  const field = new Map<SeriesKey, keyof Omit<PositionSample, 'time'>>()
  const set = (p: Parameter | undefined, f: keyof Omit<PositionSample, 'time'>) => p && field.set(p.seriesKey, f)
  set(params.latitude, 'lat')
  set(params.longitude, 'lon')
  set(params.pressure, 'pressure')
  set(params.height, 'height')
  set(params.temperature, 'temp')
  set(params.hdop, 'hdop')
  const byTime = new Map<string, PositionSample>()
  for (const r of rows) {
    const f = field.get(r.seriesKey)
    if (!f || r.value === null) continue
    const s = byTime.get(r.time) ?? { time: r.time }
    s[f] = r.value
    byTime.set(r.time, s)
  }
  return [...byTime.values()].sort((a, b) => Date.parse(a.time) - Date.parse(b.time))
}

export function referenceSamples(params: PositionParameters, rows: SeriesRow[]): ReferenceSample[] {
  return positionSamples(params, rows).flatMap((s) => (s.pressure === undefined ? [] : [{ time: s.time, pressure: s.pressure, temp: s.temp }]))
}
