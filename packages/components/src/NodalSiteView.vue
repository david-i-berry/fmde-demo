<script setup lang="ts">
// Site view: a wireframe of the building with the node placed in 3D:
// x/y from GPS, floor from barometric height against a reference node. Drag to orbit (dragging
// right turns the building with the pointer), scroll to zoom. No auto-orbit or pulsing when the
// user prefers reduced motion. Takes a SiteBuilding and positions; does no FMDE decoding.
import { TresCanvas } from '@tresjs/core'
import type { SiteBuilding, SitePosition } from '@nodal/model'
import { NoToneMapping, PerspectiveCamera } from 'three'
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { formatTime } from './format'
import { SITE_THEME_DARK, SITE_THEME_LIGHT, SiteScene } from './site3d'

const props = withDefaults(
  defineProps<{
    building: SiteBuilding
    /** positions in time order; the current one is `index` (default: the latest) */
    track: SitePosition[]
    index?: number
    nodeLabel?: string
    dark?: boolean
    height?: string
    utc?: boolean
    sensorAboveFloor?: number
    /** how many positions before the current one to draw as a trail */
    trail?: number
  }>(),
  { dark: false, height: '70vh', utc: true, sensorAboveFloor: 1.1, trail: 30 },
)

const reduceMotion = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
const scene = shallowRef(new SiteScene(props.building))
watch(
  () => props.building,
  (b) => {
    scene.value.dispose()
    scene.value = new SiteScene(b)
    scene.value.applyTheme(props.dark ? SITE_THEME_DARK : SITE_THEME_LIGHT)
  },
)
watch(() => props.dark, (d) => scene.value.applyTheme(d ? SITE_THEME_DARK : SITE_THEME_LIGHT), { immediate: true })
onBeforeUnmount(() => scene.value.dispose())

const current = computed<SitePosition | null>(() => props.track[props.index ?? props.track.length - 1] ?? null)
const trail = computed(() => {
  const i = props.index ?? props.track.length - 1
  return props.track.slice(Math.max(0, i - props.trail), i + 1)
})

// --- camera: orbit around the building ---
const camera = new PerspectiveCamera(40, 1, 0.5, 2000)
// zoom multiplies a distance that frames the site for the current aspect ratio (narrow phones step back)
const view = { az: 0.9, el: 0.55, zoom: 1, auto: !reduceMotion, lastTouch: 0 }
const autoOrbit = ref(!reduceMotion)
watch(autoOrbit, (v) => (view.auto = v))
let drag: { x: number; y: number } | null = null
function onPointerDown(e: PointerEvent) {
  drag = { x: e.clientX, y: e.clientY }
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  view.lastTouch = performance.now()
}
function onPointerMove(e: PointerEvent) {
  if (!drag) return
  view.az += (e.clientX - drag.x) * 0.006
  view.el = Math.max(0.08, Math.min(1.35, view.el + (e.clientY - drag.y) * 0.005))
  drag = { x: e.clientX, y: e.clientY }
  view.lastTouch = performance.now()
}
function onWheel(e: WheelEvent) {
  view.zoom = Math.max(0.35, Math.min(2.5, view.zoom * (1 + Math.sign(e.deltaY) * 0.08)))
  view.lastTouch = performance.now()
}

function onLoop({ delta, elapsed }: { delta: number; elapsed: number }) {
  const s = scene.value
  const dist = ((s.radius * 2.6) / Math.min(1, camera.aspect || 1)) * view.zoom
  if (view.auto && performance.now() - view.lastTouch > 3500) view.az += delta * 0.08
  const cy = (s.bottom + s.top) * 0.45
  const { x: cx, y: cz } = s.center
  camera.position.set(cx + Math.cos(view.az) * Math.cos(view.el) * dist, cy + Math.sin(view.el) * dist, cz + Math.sin(view.az) * Math.cos(view.el) * dist)
  camera.lookAt(cx, cy, cz)
  s.update(current.value, trail.value, reduceMotion ? 0.5 : (elapsed / 1.6) % 1, props.sensorAboveFloor)
}

const levelsTopDown = computed(() => [...props.building.levels].sort((a, b) => b.z - a.z))
const fmt = (v: number | undefined, dp: number, unit = '') => (v === undefined ? '—' : `${v.toFixed(dp)}${unit}`)
const SOURCE: Record<string, string> = {
  pressure: 'pressure vs reference',
  height: 'reported height',
  nominal: 'nominal (metadata)',
  gps: 'GPS',
  last: 'last GPS fix',
}
</script>

<template>
  <div>
  <div class="nodal-site" :class="{ 'nodal-site--dark': dark }" :style="{ height }">
    <div
      class="nodal-site__canvas"
      role="img"
      :aria-label="`3D wireframe of ${building.name}${current ? `, node on level ${current.level.label}` : ''}`"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="drag = null"
      @pointercancel="drag = null"
      @wheel.prevent="onWheel"
    >
      <TresCanvas :camera="camera" :alpha="true" :clear-alpha="0" :tone-mapping="NoToneMapping" :antialias="true" @loop="onLoop">
        <primitive :object="scene.root" />
      </TresCanvas>
    </div>

    <aside class="nodal-site__panel" aria-live="polite">
      <div class="text-caption nodal-site__dim">{{ nodeLabel }}</div>
      <div class="d-flex align-baseline ga-3 mb-2">
        <b class="nodal-site__floor" data-testid="site-floor">{{ current?.level.label ?? '—' }}</b>
        <span class="nodal-site__dim text-body-2">{{ current ? current.level.name : 'no position yet' }}<br />floor from {{ current ? SOURCE[current.zSource] : '—' }}</span>
      </div>
      <dl>
        <dt>Floor height</dt><dd>{{ fmt(current?.z, 1, ' m') }}</dd>
        <dt>Pressure, node</dt><dd>{{ fmt(current?.pressure, 2, ' hPa') }}</dd>
        <dt>Pressure, reference</dt><dd>{{ fmt(current?.refPressure, 2, ' hPa') }}</dd>
        <dt class="secondary">Latitude</dt><dd class="secondary">{{ fmt(current?.lat, 6, '°') }}</dd>
        <dt class="secondary">Longitude</dt><dd class="secondary">{{ fmt(current?.lon, 6, '°') }}</dd>
        <dt>GPS HDOP</dt><dd>{{ fmt(current?.hdop, 1) }}</dd>
        <dt class="secondary">Position</dt><dd class="secondary">{{ current ? SOURCE[current.xySource] : '—' }}</dd>
        <dt class="secondary">Time</dt><dd class="secondary">{{ current ? formatTime(current.time, utc) : '—' }}</dd>
      </dl>
    </aside>

    <nav class="nodal-site__levels" aria-label="Levels">
      <span
        v-for="l in levelsTopDown"
        :key="l.label"
        class="nodal-site__level"
        :class="{ current: current?.level.label === l.label, under: l.z < 0 }"
        :title="l.name"
        :aria-current="current?.level.label === l.label ? 'location' : undefined"
      >{{ l.label }}</span>
    </nav>

    <div class="nodal-site__footer">
      <button v-if="!reduceMotion" class="nodal-site__btn" :aria-pressed="!autoOrbit" @click="autoOrbit = !autoOrbit">
        {{ autoOrbit ? 'Pause orbit' : 'Resume orbit' }}
      </button>
    </div>
  </div>
  <p class="text-caption text-medium-emphasis mt-1 mb-0">{{ building.attribution }}</p>
  </div>
</template>

<style scoped>
.nodal-site {
  --bg: #eef3f7;
  --ink: #0d2a44;
  --ink-dim: #4f6b84;
  --panel: rgba(255, 255, 255, 0.82);
  --panel-edge: #b9cde0;
  --mark: #d2561b;
  --under: #8a3fd1;
  position: relative;
  overflow: hidden;
  border-radius: 8px;
  background: var(--bg);
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}
.nodal-site--dark {
  --bg: #03080d;
  --ink: #cfeeff;
  --ink-dim: #6f98b3;
  --panel: rgba(4, 16, 26, 0.78);
  --panel-edge: #12405a;
  --mark: #ff9a3c;
  --under: #c084ff;
}
.nodal-site__canvas {
  position: absolute;
  inset: 0;
  touch-action: none;
  cursor: grab;
}
.nodal-site__canvas:active {
  cursor: grabbing;
}
.nodal-site__panel {
  position: absolute;
  right: 12px;
  top: 12px;
  width: min(18rem, calc(100% - 24px));
  background: var(--panel);
  border: 1px solid var(--panel-edge);
  border-radius: 4px;
  padding: 10px 12px;
  backdrop-filter: blur(6px);
}
.nodal-site__floor {
  font-size: 3rem;
  line-height: 1;
  font-weight: 500;
  color: var(--mark);
}
.nodal-site__dim {
  color: var(--ink-dim);
}
dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 12px;
  margin: 0;
  font-size: 0.85rem;
}
dt {
  color: var(--ink-dim);
}
dd {
  margin: 0;
  text-align: right;
}
.nodal-site__levels {
  position: absolute;
  left: 12px;
  top: 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.nodal-site__level {
  min-width: 2rem;
  padding: 1px 6px;
  text-align: center;
  font-size: 0.8rem;
  border: 1px solid var(--panel-edge);
  border-radius: 3px;
  background: var(--panel);
}
.nodal-site__level.under {
  color: var(--under);
}
.nodal-site__level.current {
  border-color: var(--mark);
  color: var(--mark);
  font-weight: 600;
}
.nodal-site__footer {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 8px;
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 0.72rem;
  pointer-events: none;
}
.nodal-site__btn {
  pointer-events: auto;
  font: inherit;
  font-size: 0.85rem;
  padding: 4px 10px;
  border-radius: 3px;
  background: var(--panel);
  color: var(--ink);
  border: 1px solid var(--panel-edge);
  cursor: pointer;
  white-space: nowrap;
}
.nodal-site__btn:focus-visible {
  outline: 2px solid var(--mark);
  outline-offset: 2px;
}
@media (max-width: 640px) {
  .nodal-site__panel {
    top: auto;
    bottom: 40px;
    right: 8px;
    left: 56px;
    width: auto;
    padding: 6px 8px;
  }
  .nodal-site__floor {
    font-size: 2rem;
  }
  dl {
    font-size: 0.75rem;
  }
  .secondary {
    display: none;
  }
}
</style>
