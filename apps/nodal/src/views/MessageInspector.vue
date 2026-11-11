<script setup lang="ts">
// Live stream of messages as decoded and validated by the leader's ingest worker.
import { formatTime } from '@nodal/components'
import { CONFORMANCE_CODES, type ConformanceCode } from '@nodal/model'
import type { IngestEvent } from '@nodal/ingest'
import { computed, ref } from 'vue'
import { features } from '../runtime-config'
import { useUiStore } from '../stores/ui'

const ui = useUiStore()
const search = ref('')
const codes = ref<ConformanceCode[]>([])
const onlyIssues = ref(false)

const rows = computed(() => {
  const q = search.value.trim().toLowerCase()
  return ui.events
    .filter((e) => !q || e.topic.toLowerCase().includes(q))
    .filter((e) => !onlyIssues.value || e.issues.length > 0)
    .filter((e) => codes.value.length === 0 || e.issues.some((i) => codes.value.includes(i.code)))
    .slice()
    .reverse()
})

const allHeaders = [
  { title: 'Received', key: 'receivedAt' },
  { title: 'Topic', key: 'topic' },
  { title: 'Kind', key: 'kind' },
  { title: 'Content', key: 'content', sortable: false },
  { title: 'Bytes', key: 'payloadBytes', align: 'end' as const },
  { title: 'Issues', key: 'issues', sortable: false },
]
const headers = computed(() => (features.hideConformance ? allHeaders.filter((h) => h.key !== 'issues') : allHeaders))

function content(e: IngestEvent): string {
  if (e.duplicate) return 'duplicate (skipped)'
  if (e.kind === 'metadata') return `metadata v${e.metadataVersion}${e.newMetadataVersion ? ' (new)' : ' (unchanged)'}`
  if (e.kind === 'data') return `${e.observations ?? 0} observation(s)`
  return ''
}

function exportJson() {
  const out = features.hideConformance ? rows.value.map(({ issues: _issues, ...e }) => e) : rows.value
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `nodal-inspector-${new Date().toISOString().replace(/[:.]/g, '')}.json`
  a.click()
  URL.revokeObjectURL(a.href)
}
</script>

<template>
  <v-card variant="outlined">
    <v-card-title class="d-flex align-center flex-wrap ga-2">
      Message inspector
      <v-chip size="small" label>{{ ui.events.length }} received this session</v-chip>
      <v-spacer />
      <v-btn :prepend-icon="ui.paused ? 'mdi-play' : 'mdi-pause'" variant="tonal" size="small" @click="ui.paused = !ui.paused">
        {{ ui.paused ? 'Resume' : 'Pause' }}
      </v-btn>
      <v-btn prepend-icon="mdi-download" variant="tonal" size="small" :disabled="rows.length === 0" @click="exportJson">Export</v-btn>
      <v-btn prepend-icon="mdi-delete-outline" variant="text" size="small" @click="ui.events = []">Clear</v-btn>
    </v-card-title>
    <v-card-subtitle>
      <template v-if="features.hideConformance">Messages decoded by the ingest worker from now on.</template>
      <template v-else>Messages decoded by the ingest worker from now on, with conformance checks. Persisted issues are on the status board and node pages.</template>
    </v-card-subtitle>
    <v-card-text>
      <v-row dense>
        <v-col cols="12" md="5"><v-text-field v-model="search" label="Filter by topic (group or node)" prepend-inner-icon="mdi-magnify" density="compact" hide-details clearable /></v-col>
        <v-col v-if="!features.hideConformance" cols="12" md="5"><v-select v-model="codes" :items="[...CONFORMANCE_CODES]" label="Issue codes" multiple chips closable-chips density="compact" hide-details /></v-col>
        <v-col v-if="!features.hideConformance" cols="12" md="2"><v-switch v-model="onlyIssues" label="Issues only" density="compact" hide-details color="primary" /></v-col>
      </v-row>
    </v-card-text>
    <v-data-table :headers="headers" :items="rows" density="compact" :items-per-page="50" item-value="messageId">
      <template #item.receivedAt="{ item }">{{ formatTime(item.receivedAt, ui.prefs.utc) }}</template>
      <template #item.kind="{ item }">
        <v-chip size="x-small" label :prepend-icon="item.kind === 'metadata' ? 'mdi-file-document-outline' : item.kind === 'data' ? 'mdi-chart-line' : 'mdi-help'">
          {{ item.kind }}{{ item.retain ? ' · retained' : '' }}
        </v-chip>
      </template>
      <template #item.content="{ item }">{{ content(item) }}</template>
      <template #item.issues="{ item }">
        <v-chip v-for="(i, n) in item.issues" :key="n" size="x-small" color="error" variant="tonal" class="me-1" :title="i.detail">{{ i.code }}</v-chip>
      </template>
      <template #no-data>Waiting for messages. Start a source in Settings.</template>
    </v-data-table>
  </v-card>
</template>
