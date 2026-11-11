<script setup lang="ts">
import type { NodeKey, NodeStatus } from '@nodal/model'
import { formatAge, formatDuration } from './format'
import NodalConformanceChip from './NodalConformanceChip.vue'
import NodalStateChip from './NodalStateChip.vue'
import { CONFORMANCE_ORDER, STATE_ORDER } from './state'

import { computed } from 'vue'

const props = withDefaults(defineProps<{ nodes: NodeStatus[]; loading?: boolean; dense?: boolean; hideConformance?: boolean }>(), {
  loading: false,
  dense: false,
  hideConformance: false,
})
const emit = defineEmits<{ 'select:node': [nodeKey: NodeKey] }>()

const allHeaders = [
  { title: 'State', key: 'state', sortRaw: (a: NodeStatus, b: NodeStatus) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state) },
  { title: 'Node', key: 'nodeKey' },
  { title: 'Last seen', key: 'lastSeenAgeSeconds', align: 'end' as const },
  { title: 'Empty values', key: 'emptyValues', align: 'end' as const },
  { title: 'Undecoded', key: 'lostData', align: 'end' as const },
  { title: 'Conformance', key: 'conformance', sortRaw: (a: NodeStatus, b: NodeStatus) => CONFORMANCE_ORDER.indexOf(a.conformance) - CONFORMANCE_ORDER.indexOf(b.conformance) },
  { title: 'Median latency', key: 'medianLatencySeconds', align: 'end' as const },
  { title: 'Messages', key: 'messages', align: 'end' as const },
]
const headers = computed(() => (props.hideConformance ? allHeaders.filter((h) => h.key !== 'conformance') : allHeaders))
</script>

<template>
  <v-data-table
    :headers="headers"
    :items="nodes"
    :loading="loading"
    :density="dense ? 'compact' : 'default'"
    item-value="nodeKey"
    :sort-by="[{ key: 'state', order: 'asc' }]"
    :items-per-page="-1"
    hide-default-footer
    hover
    mobile-breakpoint="sm"
    @click:row="(_e: unknown, { item }: { item: NodeStatus }) => emit('select:node', item.nodeKey)"
  >
    <template #item.state="{ item }"><NodalStateChip :state="item.state" /></template>
    <template #item.nodeKey="{ item }">
      <div class="font-weight-medium">{{ item.name || item.nodeId }}</div>
      <div class="text-caption text-medium-emphasis">{{ item.nodeKey }}</div>
    </template>
    <template #item.lastSeenAgeSeconds="{ item }">{{ formatAge(item.lastSeenAgeSeconds) }}</template>
    <template #item.medianLatencySeconds="{ item }">{{ formatDuration(item.medianLatencySeconds) }}</template>
    <template #item.emptyValues="{ item }">
      <span :class="{ 'text-warning font-weight-bold': item.emptyValues > 0 }">{{ item.emptyValues }}</span>
      <span v-if="item.expectedEmptyValues" class="text-medium-emphasis" title="Empty values in parameters marked as expected-empty (not counted)"> +{{ item.expectedEmptyValues }}</span>
    </template>
    <template #item.lostData="{ item }">
      <span :class="{ 'text-warning font-weight-bold': item.lostData > 0 }" title="Data messages or observations that could not be decoded or stored">{{ item.lostData }}</span>
    </template>
    <template #item.conformance="{ item }">
      <NodalConformanceChip :conformance="item.conformance" size="x-small" :title="`${item.conformanceErrors} error(s), ${item.conformanceWarnings} warning(s)`" />
    </template>
    <template #no-data>No nodes yet. Connect to a broker or replay a capture in Settings.</template>
  </v-data-table>
</template>
