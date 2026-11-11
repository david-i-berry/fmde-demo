// Three.js scene for the site view, built from any SiteBuilding. Ported from
// prototypes/building-wireframe.html, with the WMO-specific geometry replaced by rules over the
// building model: each outline is drawn at every level that uses it and walled up to the next
// level (or its `<outline>Top` height); levels below ground use the underground colour.
import { ring, rings, type Ring, type SiteBuilding, type SitePosition } from '@nodal/model'
import * as THREE from 'three'

export interface SiteTheme {
  line: string
  dim: string
  under: string
  mark: string
  dark: boolean
}
// From the prototype: blueprint on light, glowing cyan (additive) on dark; underground violet, never grey.
export const SITE_THEME_LIGHT: SiteTheme = { line: '#1f5f9a', dim: '#9db7cf', under: '#8a3fd1', mark: '#d2561b', dark: false }
export const SITE_THEME_DARK: SiteTheme = { line: '#39d0ff', dim: '#0f4a63', under: '#c084ff', mark: '#ff9a3c', dark: true }

/** three.js axes: x east, y up (height), z south. */
const V = (x: number, h: number, y: number) => new THREE.Vector3(x, h, y)

export class SiteScene {
  readonly root = new THREE.Group()
  readonly bottom: number
  readonly top: number
  readonly radius: number
  /** centre of the site footprint, local metres */
  readonly center: { x: number; y: number }
  private readonly building: SiteBuilding
  private readonly mats = {
    line: new THREE.LineBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false }),
    dim: new THREE.LineBasicMaterial({ transparent: true, opacity: 0.55, depthWrite: false }),
    under: new THREE.LineBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false }),
    slab: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }),
    underFill: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false }),
    mark: new THREE.LineBasicMaterial({ transparent: true, opacity: 0.95, depthWrite: false }),
    pulse: new THREE.LineBasicMaterial({ transparent: true, opacity: 0.8, depthWrite: false }),
    shadow: new THREE.LineBasicMaterial({ transparent: true, opacity: 0.35, depthWrite: false }),
    track: new THREE.LineBasicMaterial({ transparent: true, opacity: 0.45, depthWrite: false }),
    tracer: new THREE.LineDashedMaterial({ dashSize: 0.8, gapSize: 0.6, transparent: true, opacity: 0.8 }),
    dot: new THREE.MeshBasicMaterial({ depthTest: false }),
    sprite: new THREE.SpriteMaterial({ transparent: true, depthWrite: false, depthTest: false }),
  }
  private readonly slabs = new Map<string, THREE.Mesh>()
  private readonly grid: THREE.GridHelper
  private readonly marker = new THREE.Group()
  private readonly dot: THREE.Mesh
  private readonly sprite: THREE.Sprite
  private readonly ringMesh: THREE.LineLoop
  private readonly pulse: THREE.LineLoop
  private readonly shadow: THREE.LineLoop
  private readonly tracerGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()])
  private readonly tracer: THREE.Line
  private readonly trackLine: THREE.Line
  private readonly glow: THREE.CanvasTexture | null

  constructor(building: SiteBuilding) {
    this.building = building
    const b = building
    const levels = [...b.levels].sort((a, c) => a.z - c.z)
    const floor = b.heights.floor ?? 3.6
    const ringAt = (r: Ring, h: number, mat: THREE.LineBasicMaterial) =>
      new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(r.map(([x, y]) => V(x, h, y))), mat)
    const segs: Record<'line' | 'dim' | 'under', THREE.Vector3[]> = { line: [], dim: [], under: [] }
    const wall = (x: number, y: number, h0: number, h1: number, kind: 'line' | 'dim' = 'line') => {
      if (h0 < 0) segs.under.push(V(x, h0, y), V(x, Math.min(h1, 0), y))
      if (h1 > 0) segs[kind].push(V(x, Math.max(h0, 0), y), V(x, h1, y))
    }

    // each outline: rings at its levels, walls up to the next level (or `<name>Top`)
    for (const name of new Set(levels.map((l) => l.outline))) {
      const r = ring(b, name)
      if (!r) continue
      const own = levels.filter((l) => l.outline === name)
      const last = own.at(-1)!
      const next = levels.find((l) => l.z > last.z)
      const explicit = b.heights[`${name}Top`]
      const top = explicit !== undefined ? Math.max(explicit, last.z + 1.5) : (next?.z ?? last.z + floor)
      own.forEach((l, i) => this.root.add(ringAt(r, l.z, l.z < 0 ? this.mats.under : i === 0 ? this.mats.line : this.mats.dim)))
      this.root.add(ringAt(r, top, top <= 0 ? this.mats.under : this.mats.line))
      r.forEach(([x, y], i) => i % 2 === 0 && wall(x, y, own[0]!.z, top))

      const slab = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(r.map(([x, y]) => new THREE.Vector2(x, y)))), this.mats.slab)
      slab.rotation.x = Math.PI / 2
      slab.visible = false
      this.slabs.set(name, slab)
      this.root.add(slab)
      for (const l of own.filter((x) => x.z < 0)) {
        const fill = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(r.map(([x, y]) => new THREE.Vector2(x, y)))), this.mats.underFill)
        fill.rotation.x = Math.PI / 2
        fill.position.y = l.z
        this.root.add(fill)
      }
    }

    const bottom = b.heights.bottom ?? levels[0]!.z
    const topLevel = levels.at(-1)!
    const roof = b.heights[`${topLevel.outline}Top`] ?? topLevel.z + floor
    const shaftTop = b.heights.shaftTop ?? roof

    // podium: a lower roof drawn separately from the level outlines
    const podium = ring(b, 'podium')
    if (podium && b.heights.podiumTop !== undefined) {
      this.root.add(ringAt(podium, b.heights.podiumTop, this.mats.line))
      podium.forEach(([x, y]) => wall(x, y, 0, b.heights.podiumTop!))
    }
    // lift shaft through every level, with its cars, rising above the roof
    const shaft = ring(b, 'liftShaft')
    if (shaft) {
      shaft.forEach(([x, y]) => wall(x, y, bottom, shaftTop))
      levels.forEach((l) => this.root.add(ringAt(shaft, l.z, this.mats.dim)))
      this.root.add(ringAt(shaft, shaftTop, this.mats.line))
    }
    for (const car of rings(b, 'liftCars')) {
      car.forEach(([x, y]) => wall(x, y, bottom, shaftTop, 'dim'))
      this.root.add(ringAt(car, shaftTop, this.mats.dim))
    }
    // ramps between two heights
    const ramps = b.features.parkingRamp as [number, number][][] | undefined
    const rampFrom = (b.features.rampFrom as number | undefined) ?? 0
    const rampTo = (b.features.rampTo as number | undefined) ?? bottom
    for (const r of ramps ?? []) {
      const [[x0, y0], [x1, y1]] = r as [[number, number], [number, number]]
      ;(rampTo < 0 ? segs.under : segs.line).push(V(x0, rampFrom, y0), V(x1, rampTo, y1))
    }
    for (const kind of ['line', 'dim', 'under'] as const) {
      if (segs[kind].length) this.root.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(segs[kind]), this.mats[kind]))
    }

    // ground grid sized to the site
    const pts = [...new Set(levels.map((l) => l.outline))].flatMap((n) => ring(b, n) ?? [])
    const xs = pts.map(([x]) => x)
    const ys = pts.map(([, y]) => y)
    const center = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 }
    const radius = Math.max(...pts.map(([x, y]) => Math.hypot(x - center.x, y - center.y)), 30)
    const size = Math.ceil((radius * 2.1) / 10) * 10
    this.grid = new THREE.GridHelper(size, size / 5)
    this.grid.position.set(center.x, 0, center.y)
    ;(this.grid.material as THREE.Material).transparent = true
    ;(this.grid.material as THREE.Material).opacity = 0.35
    ;(this.grid.material as THREE.Material).depthWrite = false
    this.root.add(this.grid)

    // node marker: dot, glow, HDOP ring with pulse on the floor, tracer to ground, shadow on ground
    const unit: THREE.Vector3[] = []
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * Math.PI * 2
      unit.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)))
    }
    this.dot = new THREE.Mesh(new THREE.SphereGeometry(0.7, 16, 12), this.mats.dot)
    this.glow = typeof document === 'undefined' ? null : glowTexture()
    this.mats.sprite.map = this.glow
    this.sprite = new THREE.Sprite(this.mats.sprite)
    this.sprite.scale.set(7, 7, 1)
    this.ringMesh = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(unit), this.mats.mark)
    this.pulse = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(unit), this.mats.pulse)
    this.shadow = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(unit), this.mats.shadow)
    this.tracer = new THREE.Line(this.tracerGeo, this.mats.tracer)
    this.trackLine = new THREE.Line(new THREE.BufferGeometry(), this.mats.track)
    this.marker.add(this.dot, this.sprite, this.ringMesh, this.pulse, this.shadow, this.tracer)
    this.marker.visible = false
    this.root.add(this.marker, this.trackLine)

    this.bottom = bottom
    this.top = shaftTop
    this.radius = radius
    this.center = center
  }

  applyTheme(t: SiteTheme) {
    const line = new THREE.Color(t.line)
    const dim = new THREE.Color(t.dim)
    const under = new THREE.Color(t.under)
    const mark = new THREE.Color(t.mark)
    const blending = t.dark ? THREE.AdditiveBlending : THREE.NormalBlending
    this.mats.line.color = line
    this.mats.line.blending = blending
    this.mats.dim.color = dim
    this.mats.under.color = under
    this.mats.underFill.color = under
    this.mats.slab.color = line
    for (const m of [this.mats.mark, this.mats.pulse, this.mats.shadow, this.mats.track, this.mats.tracer]) m.color = mark
    this.mats.dot.color = mark
    this.mats.sprite.color = mark
    this.mats.sprite.blending = blending
    this.mats.sprite.opacity = t.dark ? 1 : 0.55
    ;(this.grid.material as THREE.LineBasicMaterial).color = dim
    ;(this.grid.material as THREE.LineBasicMaterial).vertexColors = false
    for (const m of Object.values(this.mats)) m.needsUpdate = true
  }

  /**
   * Place the marker at `pos` (barometer height = floor z + sensorAboveFloor), fill its level, and
   * draw the recent track. `phase` (0–1) animates the pulse; pass a constant for reduced motion.
   */
  update(pos: SitePosition | null, track: SitePosition[], phase: number, sensorAboveFloor = 1.1) {
    for (const s of this.slabs.values()) s.visible = false
    if (!pos) {
      this.marker.visible = false
      this.trackLine.visible = false
      return
    }
    const slab = this.slabs.get(pos.level.outline)
    if (slab) {
      slab.visible = true
      slab.position.y = pos.level.z + 0.02
    }
    const h = pos.z + sensorAboveFloor
    this.marker.visible = true
    this.dot.position.set(pos.x, h, pos.y)
    this.sprite.position.copy(this.dot.position)
    this.sprite.scale.setScalar(6 + Math.sin(phase * Math.PI * 2))
    const rr = Math.max(2, (pos.hdop ?? 1) * 2.4)
    this.ringMesh.position.set(pos.x, pos.level.z + 0.05, pos.y)
    this.ringMesh.scale.set(rr, 1, rr)
    this.pulse.position.copy(this.ringMesh.position)
    this.pulse.scale.set(rr * (1 + phase * 1.6), 1, rr * (1 + phase * 1.6))
    this.mats.pulse.opacity = 0.8 * (1 - phase)
    this.shadow.position.set(pos.x, 0.05, pos.y)
    this.shadow.scale.set(1.2, 1, 1.2)
    const p = this.tracerGeo.attributes.position as THREE.BufferAttribute
    p.setXYZ(0, pos.x, h, pos.y)
    p.setXYZ(1, pos.x, 0, pos.y)
    p.needsUpdate = true
    this.tracer.computeLineDistances()

    this.trackLine.visible = track.length > 1
    if (track.length > 1) {
      this.trackLine.geometry.dispose()
      this.trackLine.geometry = new THREE.BufferGeometry().setFromPoints(track.map((q) => V(q.x, q.z + sensorAboveFloor, q.y)))
    }
  }

  dispose() {
    this.root.traverse((o) => {
      const g = (o as THREE.Mesh).geometry
      if (g) g.dispose()
    })
    for (const m of Object.values(this.mats)) m.dispose()
    this.glow?.dispose()
  }
}

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  grd.addColorStop(0, 'rgba(255,255,255,1)')
  grd.addColorStop(0.25, 'rgba(255,255,255,.55)')
  grd.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, 128, 128)
  return new THREE.CanvasTexture(c)
}
