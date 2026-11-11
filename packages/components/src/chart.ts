// Shared ECharts setup and chart tokens (validated: dataviz reference palette, light + dark).
import { ScatterChart, LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, MarkAreaComponent, DataZoomComponent } from 'echarts/components'
import { use } from 'echarts/core'
import { SVGRenderer } from 'echarts/renderers'

use([LineChart, ScatterChart, GridComponent, TooltipComponent, MarkAreaComponent, DataZoomComponent, SVGRenderer])

export interface ChartTokens {
  series: string
  /** status: warning-level marks (empty values, backlog flushes). Never used as a series colour. */
  attention: string
  ink: string
  muted: string
  grid: string
  axis: string
}

export function chartTokens(dark: boolean): ChartTokens {
  return dark
    ? { series: '#3987e5', attention: '#ec835a', ink: '#f0efec', muted: '#898781', grid: '#2c2c2a', axis: '#383835' }
    : { series: '#2a78d6', attention: '#ec835a', ink: '#0b0b0b', muted: '#898781', grid: '#e1e0d9', axis: '#c3c2b7' }
}

export function timeAxis(t: ChartTokens, utc: boolean) {
  return {
    type: 'time' as const,
    axisLine: { lineStyle: { color: t.axis } },
    axisTick: { show: false },
    axisLabel: {
      color: t.muted,
      fontSize: 11,
      hideOverlap: true,
      formatter: (v: number) => {
        const d = new Date(v)
        const h = utc ? d.getUTCHours() : d.getHours()
        const m = utc ? d.getUTCMinutes() : d.getMinutes()
        if (h === 0 && m === 0) return utc ? d.toISOString().slice(5, 10) : `${d.getMonth() + 1}-${d.getDate()}`
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
      },
    },
    splitLine: { show: false },
  }
}

export function valueAxis(t: ChartTokens, extra: Record<string, unknown> = {}) {
  return {
    type: 'value' as const,
    scale: true,
    splitNumber: 3,
    axisLabel: { color: t.muted, fontSize: 11 },
    splitLine: { lineStyle: { color: t.grid, width: 1 } },
    ...extra,
  }
}

export function tooltipBase(t: ChartTokens, dark: boolean) {
  return {
    backgroundColor: dark ? '#262624' : '#ffffff',
    borderColor: t.axis,
    textStyle: { color: t.ink, fontSize: 12 },
    confine: true,
  }
}

export function stamp(ms: number, utc: boolean): string {
  const d = new Date(ms)
  return utc ? `${d.toISOString().slice(0, 16).replace('T', ' ')}Z` : d.toLocaleString()
}
