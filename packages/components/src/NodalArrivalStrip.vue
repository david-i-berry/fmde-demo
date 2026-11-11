<script setup lang="ts">
// Message arrival strip: one dot per data message at its receipt time, height = latency of the
// newest observation. Backlog flushes (message reaching back more than `backlogSeconds`)
// are drawn as larger diamonds, sized by observation count.
import { computed } from 'vue'
import VChart from 'vue-echarts'
import { chartTokens, stamp, timeAxis, tooltipBase, valueAxis } from './chart'
import { formatDuration } from './format'

export interface ArrivalPoint {
  receivedAt: string
  latencySeconds: number | null
  spanSeconds: number | null
  observations: number
  payloadBytes: number
}

const props = withDefaults(
  defineProps<{ messages: ArrivalPoint[]; from: string; to: string; dark?: boolean; utc?: boolean; backlogSeconds?: number }>(),
  { dark: false, utc: true, backlogSeconds: 3600 },
)
const emit = defineEmits<{ 'select:message': [index: number] }>()

function onClick(p: { data?: unknown }) {
  const index = (p.data as { index?: number } | undefined)?.index
  if (index !== undefined) emit('select:message', index)
}

const backlogCount = computed(() => props.messages.filter((m) => (m.spanSeconds ?? 0) > props.backlogSeconds).length)

const option = computed(() => {
  const t = chartTokens(props.dark)
  const row = (m: ArrivalPoint, i: number) => ({ value: [Date.parse(m.receivedAt), Math.max(m.latencySeconds ?? 0, 1)], index: i })
  const live = props.messages.flatMap((m, i) => ((m.spanSeconds ?? 0) > props.backlogSeconds ? [] : [row(m, i)]))
  const backlog = props.messages.flatMap((m, i) =>
    (m.spanSeconds ?? 0) > props.backlogSeconds ? [{ ...row(m, i), symbolSize: Math.min(22, 10 + Math.sqrt(m.observations)) }] : [],
  )
  return {
    animation: false,
    grid: { left: 48, right: 12, top: 10, bottom: 22 },
    xAxis: { ...timeAxis(t, props.utc), min: Date.parse(props.from), max: Date.parse(props.to) },
    yAxis: valueAxis(t, { type: 'log', scale: false, min: 1, name: '', axisLabel: { color: t.muted, fontSize: 11, formatter: (v: number) => formatDuration(v) } }),
    tooltip: {
      ...tooltipBase(t, props.dark),
      trigger: 'item',
      formatter: (p: { data: { index: number } }) => {
        const m = props.messages[p.data.index]!
        const lines = [
          `<b>${stamp(Date.parse(m.receivedAt), props.utc)}</b>`,
          `latency ${formatDuration(m.latencySeconds)}`,
          `${m.observations} observation(s), ${m.payloadBytes} bytes`,
        ]
        if ((m.spanSeconds ?? 0) > props.backlogSeconds) lines.push(`backlog reaching back ${formatDuration(m.spanSeconds)}`)
        return lines.join('<br>')
      },
    },
    series: [
      { type: 'scatter', data: live, symbolSize: 8, itemStyle: { color: t.series, opacity: 0.85 } },
      { type: 'scatter', data: backlog, symbol: 'diamond', itemStyle: { color: t.attention, borderColor: props.dark ? '#1a1a19' : '#fcfcfb', borderWidth: 2 } },
    ],
  }
})
</script>

<template>
  <div>
    <div class="d-flex flex-wrap ga-4 text-caption text-medium-emphasis mb-1">
      <span><span class="nodal-dot" /> data message (height = latency)</span>
      <span v-if="backlogCount"><span class="nodal-diamond">◆</span> backlog flush ({{ backlogCount }})</span>
    </div>
    <VChart :option="option" style="height: 160px" autoresize @click="onClick" />
  </div>
</template>

<style scoped>
.nodal-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #2a78d6;
  vertical-align: middle;
}
.nodal-diamond {
  color: #ec835a;
}
</style>
