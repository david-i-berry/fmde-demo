<script setup lang="ts">
import { calibrationOffset, type Calibration, type MetadataVersion, type ObsValue, type Parameter, type SeriesKey } from '@nodal/model'
import { computed } from 'vue'
import { formatTime, formatValue } from './format'

const props = defineProps<{
  metadata: MetadataVersion
  latest: Record<SeriesKey, { time: string; value: ObsValue }>
  utc?: boolean
  /** long names (or series keys) whose empty values are expected; omit to hide the toggle */
  expectedEmpty?: string[]
  /** calibration offsets by long name (or series key); omit to hide the column */
  calibration?: Record<string, Calibration>
}>()
const emit = defineEmits<{ 'select:param': [seriesKey: SeriesKey]; 'toggle:expected-empty': [longName: string]; 'edit:calibration': [parameter: Parameter] }>()

const isExpectedEmpty = (p: Parameter) => !!props.expectedEmpty?.some((n) => n === p.longName || n === p.seriesKey)
const offsetOf = (p: Parameter) => calibrationOffset({ calibration: props.calibration }, p)
const noteOf = (p: Parameter) => (props.calibration?.[p.seriesKey] ?? props.calibration?.[p.longName])?.note
const signed = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x)}`
/** the latest value with the calibration applied, for numeric values with an offset */
function corrected(p: Parameter): string | null {
  const v = props.latest[p.seriesKey]?.value
  const off = offsetOf(p)
  return off && typeof v === 'number' ? formatValue(Math.round((v + off) * 1e6) / 1e6, p.unit) : null
}

const definitions = computed(() => {
  const groups = new Map<number, Parameter[]>()
  for (const p of props.metadata.parameters) groups.set(p.definitionId, [...(groups.get(p.definitionId) ?? []), p])
  return [...groups.entries()].map(([id, params]) => ({ id, description: params[0]?.definitionDescription ?? '', params }))
})

function device(p: Parameter): string {
  if (p.device.kind === 'node') return 'node'
  if (p.device.kind === 'observer') {
    const id = p.device.observerId
    return props.metadata.observers.find((o) => o.id === id)?.name ?? `observer ${id}`
  }
  return '—'
}

function standardName(p: Parameter): { label: string; href?: string } | null {
  const [prefix, name] = Object.entries(p.standardNames)[0] ?? []
  if (!prefix || !name) return null
  const ns = props.metadata.namespaces[prefix]
  return { label: `${prefix}:${name}`, href: ns ? `${ns}${name}` : undefined }
}

function cell(p: Parameter): string {
  if (p.cellMethod === 'UNSPECIFIED') return '—'
  return p.cellPeriodSeconds ? `${p.cellMethod.toLowerCase()} over ${p.cellPeriodSeconds} s` : p.cellMethod.toLowerCase()
}
</script>

<template>
  <v-card v-for="d in definitions" :key="d.id" variant="outlined" class="mb-3">
    <v-card-title class="text-subtitle-1">Definition {{ d.id }}: {{ d.description }}</v-card-title>
    <v-table density="compact">
      <thead>
        <tr><th>#</th><th>Parameter</th><th>Standard name</th><th>Cell method</th><th>Device</th><th class="text-end">Latest</th><th v-if="calibration" class="text-center" title="Calibration offset added to raw values where nodes are compared (site view)">Offset</th><th v-if="expectedEmpty" class="text-center" title="Empty values expected: not counted as data loss">Empty OK</th></tr>
      </thead>
      <tbody>
        <tr v-for="p in d.params" :key="p.key" class="cursor-pointer" @click="emit('select:param', p.seriesKey)">
          <td>{{ p.valueIndex }}</td>
          <td>{{ p.longName }} <span class="text-medium-emphasis">({{ p.unit }})</span></td>
          <td>
            <template v-if="standardName(p)">
              <a v-if="standardName(p)!.href" :href="standardName(p)!.href" target="_blank" rel="noopener" @click.stop>{{ standardName(p)!.label }}</a>
              <span v-else>{{ standardName(p)!.label }}</span>
            </template>
            <span v-else class="text-medium-emphasis">—</span>
          </td>
          <td>{{ cell(p) }}</td>
          <td>{{ device(p) }}</td>
          <td class="text-end">
            <template v-if="latest[p.seriesKey]">
              <span :class="{ 'text-warning': latest[p.seriesKey]!.value === null }">{{ formatValue(latest[p.seriesKey]!.value, p.unit) }}</span>
              <div v-if="corrected(p)" class="text-caption" :title="`Raw value; corrected with the calibration offset: ${corrected(p)}`">corrected {{ corrected(p) }}</div>
              <div class="text-caption text-medium-emphasis">{{ formatTime(latest[p.seriesKey]!.time, utc ?? true) }}</div>
            </template>
            <span v-else class="text-medium-emphasis">—</span>
          </td>
          <td v-if="calibration" class="text-center text-no-wrap">
            <v-chip
              v-if="offsetOf(p)"
              size="small"
              variant="tonal"
              color="primary"
              :title="noteOf(p) ? `Calibration: ${noteOf(p)}` : 'Calibration offset'"
              @click.stop="emit('edit:calibration', p)"
            >{{ signed(offsetOf(p)) }} {{ p.unit }}</v-chip>
            <v-btn
              v-else
              icon="mdi-tune-variant"
              variant="text"
              size="small"
              :aria-label="`Set a calibration offset for ${p.longName}`"
              title="Set a calibration offset"
              @click.stop="emit('edit:calibration', p)"
            />
          </td>
          <td v-if="expectedEmpty" class="text-center">
            <v-btn
              :icon="isExpectedEmpty(p) ? 'mdi-checkbox-marked-outline' : 'mdi-checkbox-blank-outline'"
              :color="isExpectedEmpty(p) ? 'primary' : undefined"
              variant="text"
              size="small"
              :aria-pressed="isExpectedEmpty(p)"
              :aria-label="`Empty values expected for ${p.longName}`"
              :title="isExpectedEmpty(p) ? 'Empty values expected (not counted as data loss). Click to count them again.' : 'Mark empty values as expected, e.g. no GPS fix underground or a sensor not fitted'"
              @click.stop="emit('toggle:expected-empty', p.longName)"
            />
          </td>
        </tr>
      </tbody>
    </v-table>
  </v-card>
</template>
