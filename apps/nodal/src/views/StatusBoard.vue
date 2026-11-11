<script setup lang="ts">
import {
  CONFORMANCE_META,
  CONFORMANCE_ORDER,
  NodalConformanceChip,
  NodalNodeMap,
  NodalNodeTable,
  NodalStateChip,
  STATE_META,
  STATE_ORDER,
  formatTime,
} from '@nodal/components'
import { CODE_INFO, type Conformance, type NodeKey, type NodeState } from '@nodal/model'
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useTheme } from 'vuetify'
import { useIssueSummary, useNetwork, useNodeStatus } from '../composables/nodal'
import { features } from '../runtime-config'
import { useUiStore } from '../stores/ui'

const router = useRouter()
const ui = useUiStore()
const { rows: all, loading, error } = useNodeStatus()
const { rows: issues } = useIssueSummary(20)
const { network } = useNetwork()
const theme = useTheme()

// nodes with metadata but no data (e.g. retained POC1 metadata) are hidden unless asked for
const neverSeen = computed(() => all.value.filter((n) => n.state === 'NEVER_SEEN').length)
const nodes = computed(() => (ui.prefs.showNeverSeen ? all.value : all.value.filter((n) => n.state !== 'NEVER_SEEN')))
const tiles = computed(() => STATE_ORDER.filter((s) => s !== 'NEVER_SEEN' || ui.prefs.showNeverSeen))

const filter = ref<NodeState | null>(null)
const conformanceFilter = ref<Conformance | null>(null)
const counts = computed(() => Object.fromEntries(STATE_ORDER.map((s) => [s, nodes.value.filter((n) => n.state === s).length])) as Record<NodeState, number>)
const conformanceCounts = computed(
  () => Object.fromEntries(CONFORMANCE_ORDER.map((c) => [c, nodes.value.filter((n) => n.conformance === c).length])) as Record<Conformance, number>,
)
const shown = computed(() =>
  nodes.value.filter((n) => (!filter.value || n.state === filter.value) && (!conformanceFilter.value || n.conformance === conformanceFilter.value)),
)

function toggleNeverSeen(v: boolean | null) {
  ui.prefs.showNeverSeen = !!v
  ui.savePrefs()
  if (!v && filter.value === 'NEVER_SEEN') filter.value = null
}

function open(nodeKey: NodeKey) {
  const [group, node] = nodeKey.split('/')
  void router.push({ name: 'node', params: { group, node }, query: router.currentRoute.value.query })
}
</script>

<template>
  <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>

  <v-row dense class="mb-2">
    <v-col v-for="s in tiles" :key="s" cols="6" sm="4" md="">
      <v-card
        :variant="filter === s ? 'tonal' : 'outlined'"
        :color="filter === s ? STATE_META[s].color : undefined"
        :aria-pressed="filter === s"
        @click="filter = filter === s ? null : s"
      >
        <!-- the tooltip goes on the content: a v-card `title` prop renders as a heading -->
        <v-card-text class="d-flex align-center ga-3" :title="STATE_META[s].description">
          <v-icon :icon="STATE_META[s].icon" :color="STATE_META[s].color" size="28" />
          <div>
            <div class="text-h5 font-weight-medium">{{ counts[s] }}</div>
            <div class="text-caption text-medium-emphasis">{{ STATE_META[s].label }}</div>
          </div>
        </v-card-text>
      </v-card>
    </v-col>
  </v-row>

  <div class="d-flex flex-wrap align-center ga-2 mb-3">
    <template v-if="!features.hideConformance">
    <span class="text-body-2 text-medium-emphasis me-1">Conformance:</span>
    <v-chip
      v-for="c in CONFORMANCE_ORDER"
      :key="c"
      :color="CONFORMANCE_META[c].color"
      :variant="conformanceFilter === c ? 'flat' : 'outlined'"
      :prepend-icon="CONFORMANCE_META[c].icon"
      :title="CONFORMANCE_META[c].description"
      :aria-pressed="conformanceFilter === c"
      size="small"
      label
      @click="conformanceFilter = conformanceFilter === c ? null : c"
    >
      {{ conformanceCounts[c] }} {{ CONFORMANCE_META[c].label.toLowerCase() }}
    </v-chip>
    </template>
    <v-spacer />
    <v-switch
      :model-value="ui.prefs.showNeverSeen"
      :label="`Show never-seen nodes (${neverSeen})`"
      color="primary"
      density="compact"
      hide-details
      title="Nodes with retained metadata but no data message yet"
      @update:model-value="toggleNeverSeen"
    />
  </div>

  <v-row>
    <v-col cols="12" xl="8">
      <v-card variant="outlined">
        <v-card-title class="d-flex align-center flex-wrap ga-2">
          Nodes
          <v-chip v-if="filter" size="small" closable @click:close="filter = null"><NodalStateChip :state="filter" size="x-small" class="me-1" /> only</v-chip>
          <v-chip v-if="conformanceFilter" size="small" closable @click:close="conformanceFilter = null">
            <NodalConformanceChip :conformance="conformanceFilter" size="x-small" class="me-1" /> only
          </v-chip>
        </v-card-title>
        <NodalNodeTable :nodes="shown" :loading="loading" :hide-conformance="features.hideConformance" @select:node="open" />
      </v-card>
    </v-col>
    <v-col cols="12" xl="4">
      <v-card variant="outlined" class="mb-4">
        <v-card-title class="d-flex align-center">Map<v-spacer /><v-btn size="small" variant="text" append-icon="mdi-arrow-right" :to="{ name: 'map', query: $route.query }">Open</v-btn></v-card-title>
        <v-card-text><NodalNodeMap :network="network" :dark="theme.current.value.dark" height="240px" compact @select:node="open" /></v-card-text>
      </v-card>
      <v-card v-if="!features.hideConformance" variant="outlined">
        <v-card-title>Conformance issues</v-card-title>
        <v-card-subtitle>By node and code, errors first. These do not affect node state.</v-card-subtitle>
        <v-list density="compact" lines="three">
          <v-list-item
            v-for="i in issues"
            :key="`${i.nodeKey}|${i.code}`"
            :title="`${i.code} × ${i.count}`"
            :subtitle="`${i.nodeKey ?? 'unknown topic'} · last ${formatTime(i.lastAt, ui.prefs.utc)} — ${CODE_INFO[i.code].description}`"
            @click="i.nodeKey && open(i.nodeKey)"
          >
            <template #prepend>
              <v-icon
                :icon="i.severity === 'error' ? 'mdi-close-circle-outline' : 'mdi-alert-outline'"
                :color="i.severity === 'error' ? 'error' : 'warning'"
                :title="i.severity"
              />
            </template>
          </v-list-item>
          <v-list-item v-if="issues.length === 0" title="None in this window" prepend-icon="mdi-check" />
        </v-list>
      </v-card>
    </v-col>
  </v-row>
</template>
