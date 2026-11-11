<script setup lang="ts">
// One parameter's time series (small multiple). emptyValue slots are marked along the
// bottom with a triangle, distinct in shape as well as colour.
import type { Parameter } from '@nodal/model'
import { computed } from 'vue'
import VChart from 'vue-echarts'
import { chartTokens, stamp, timeAxis, tooltipBase, valueAxis } from './chart'

export interface ParamPoint {
  t: string
  v: number | null
}

const props = withDefaults(
  defineProps<{ parameter: Parameter; points: ParamPoint[]; from: string; to: string; dark?: boolean; utc?: boolean; height?: number }>(),
  { dark: false, utc: true, height: 140 },
)

const emptyCount = computed(() => props.points.filter((p) => p.v === null).length)

const option = computed(() => {
  const t = chartTokens(props.dark)
  const p = props.parameter
  const unit = p.unit
  const line: [number, number | null][] = props.points.map((x) => [Date.parse(x.t), x.v])
  const empties = props.points.filter((x) => x.v === null).map((x) => [Date.parse(x.t), 0])
  const fmt = (v: number) => `${Math.round(v * 1000) / 1000} ${unit}`
  return {
    animation: false,
    grid: { left: 48, right: 12, top: 8, bottom: 22 },
    xAxis: { ...timeAxis(t, props.utc), min: Date.parse(props.from), max: Date.parse(props.to) },
    yAxis: [valueAxis(t), { type: 'value', show: false, min: 0, max: 1 }],
    tooltip: {
      ...tooltipBase(t, props.dark),
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: t.muted, type: 'dashed' } },
      formatter: (items: { value: [number, number | null]; seriesIndex: number }[]) => {
        const it = items[0]
        if (!it) return ''
        const value = it.seriesIndex === 1 || it.value[1] === null ? 'empty value' : fmt(it.value[1])
        return `${stamp(it.value[0], props.utc)}<br><b>${value}</b>`
      },
    },
    series: [
      {
        type: 'line',
        data: line,
        showSymbol: false,
        symbolSize: 8,
        connectNulls: false,
        lineStyle: { width: 2, color: t.series },
        itemStyle: { color: t.series },
        emphasis: { disabled: true },
      },
      {
        type: 'scatter',
        yAxisIndex: 1,
        data: empties.map(([x]) => [x, 0.06]),
        symbol: 'triangle',
        symbolSize: 8,
        itemStyle: { color: t.attention },
        z: 3,
      },
    ],
  }
})
</script>

<template>
  <div>
    <div class="d-flex align-baseline ga-2 flex-wrap">
      <span class="text-body-2 font-weight-medium">{{ parameter.longName }}</span>
      <span class="text-caption text-medium-emphasis">
        {{ parameter.unit }} · {{ parameter.cellMethod.toLowerCase() }}{{ parameter.cellPeriodSeconds ? ` ${parameter.cellPeriodSeconds} s` : '' }}
        <template v-if="Object.values(parameter.standardNames)[0]"> · {{ Object.values(parameter.standardNames)[0] }}</template>
      </span>
      <span v-if="emptyCount" class="text-caption ms-auto"><span class="nodal-empty-mark">▲</span> {{ emptyCount }} empty</span>
    </div>
    <div v-if="points.length === 0" :style="{ height: `${height}px` }" />
    <VChart v-else :option="option" :style="{ height: `${height}px` }" autoresize />
  </div>
</template>

<style scoped>
.nodal-empty-mark {
  color: #ec835a;
}
</style>
