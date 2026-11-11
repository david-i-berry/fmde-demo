<script setup lang="ts">
// Site view: the building in 3D with a node placed by GPS and floor from pressure.
import { NodalSiteView, NodalStateChip, formatTime } from '@nodal/components'
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useTheme } from 'vuetify'
import { useSiteNodes, useSiteTrack } from '../composables/site'
import { siteById } from '../sites'
import { useUiStore } from '../stores/ui'

const props = defineProps<{ site: string }>()
const route = useRoute()
const router = useRouter()
const ui = useUiStore()
const theme = useTheme()
const dark = computed(() => theme.current.value.dark)

const building = computed(() => siteById(props.site))
const { nodes, mobile } = useSiteNodes(() => props.site)

// the node shown: ?node=, else the first mobile node on the site, else the first node
const nodeKey = computed<string | null>(() => {
  const q = route.query.node
  if (typeof q === 'string' && nodes.value.some((n) => n.status.nodeKey === q)) return q
  return mobile.value[0]?.status.nodeKey ?? nodes.value[0]?.status.nodeKey ?? null
})
function selectNode(key: string) {
  void router.replace({ query: { ...route.query, node: key } })
}

const { node, reference, externalReference, externalError, track } = useSiteTrack(building, nodeKey)

// time scrubber: follow the latest position (live) unless the user picks one
const live = ref(true)
const index = ref(0)
watch(
  () => track.value.length,
  (n) => {
    if (live.value) index.value = Math.max(0, n - 1)
  },
  { immediate: true },
)
watch(live, (l) => l && (index.value = Math.max(0, track.value.length - 1)))
function scrub(i: number) {
  index.value = i
  live.value = i >= track.value.length - 1
}
const at = computed(() => track.value[index.value])
const levelsVisited = computed(() => new Set(track.value.map((p) => p.level.label)).size)
</script>

<template>
  <v-alert v-if="!building" type="warning" variant="tonal">No building model "{{ site }}". Building models live in data/sites/&lt;site&gt;.building.json.</v-alert>
  <template v-else>
    <div class="d-flex align-center flex-wrap ga-3 mb-3">
      <v-btn icon="mdi-arrow-left" variant="text" :to="{ name: 'map', query: { window: $route.query.window } }" title="Back to the map" />
      <div>
        <h1 class="text-h5">{{ building.name }}</h1>
        <div class="text-body-2 text-medium-emphasis">
          Position from GPS, floor from barometric pressure against
          <template v-if="reference">the reference node <router-link :to="{ name: 'node', params: { group: reference.status.group, node: reference.status.nodeId } }">{{ reference.metadata?.node.name || reference.status.nodeKey }}</router-link></template>
          <template v-else-if="externalReference">
            <span :title="`Station pressure (QFE), 10-minute values, barometer at ${externalReference.heightMetres} m; carried forward along its trend until newer values are published`">{{ externalReference.name }}</span>
            ({{ externalReference.attribution }})
          </template>
          <template v-else>a reference node (none found on this site: floor from reported height or nominal location)</template>.
          Drag to orbit, scroll to zoom.
        </div>
      </div>
    </div>

    <v-alert v-if="externalError && !reference" type="warning" variant="tonal" density="compact" class="mb-3">
      Pressure reference unavailable ({{ externalError }}): floor from reported height or nominal location.
    </v-alert>

    <div class="d-flex flex-wrap ga-2 mb-3 align-center">
      <span class="text-body-2 text-medium-emphasis">Nodes on this site:</span>
      <v-chip
        v-for="n in nodes"
        :key="n.status.nodeKey"
        :color="n.status.nodeKey === nodeKey ? 'primary' : undefined"
        :variant="n.status.nodeKey === nodeKey ? 'flat' : 'tonal'"
        size="small"
        label
        :prepend-icon="n.metadata && mobile.includes(n) ? 'mdi-crosshairs-gps' : 'mdi-gauge'"
        @click="selectNode(n.status.nodeKey)"
      >
        {{ n.metadata?.node.name || n.status.nodeKey }}
      </v-chip>
      <span v-if="nodes.length === 0" class="text-body-2">None yet.</span>
      <v-spacer />
      <template v-if="node">
        <NodalStateChip :state="node.status.state" />
        <v-btn size="small" variant="text" append-icon="mdi-arrow-right" :to="{ name: 'node', params: { group: node.status.group, node: node.status.nodeId }, query: { window: $route.query.window } }">Node detail</v-btn>
      </template>
    </div>

    <NodalSiteView
      :building="building"
      :track="track"
      :index="index"
      :node-label="node ? `${node.metadata?.node.name ?? ''} · ${node.status.nodeKey}` : ''"
      :dark="dark"
      :utc="ui.prefs.utc"
      height="calc(100vh - 300px)"
    />

    <div class="d-flex align-center flex-wrap ga-3 mt-2">
      <v-btn :variant="live ? 'flat' : 'tonal'" :color="live ? 'primary' : undefined" size="small" prepend-icon="mdi-access-point" @click="live = true">Live</v-btn>
      <v-slider
        :model-value="index"
        :min="0"
        :max="Math.max(0, track.length - 1)"
        :step="1"
        :disabled="track.length < 2"
        hide-details
        density="compact"
        class="flex-grow-1"
        style="min-width: 200px"
        aria-label="Position in time"
        @update:model-value="scrub"
      />
      <span class="text-caption text-medium-emphasis" style="min-width: 15em">
        {{ at ? formatTime(at.time, ui.prefs.utc) : 'no positions in this window' }} · {{ track.length }} position(s), {{ levelsVisited }} level(s)
      </span>
    </div>
  </template>
</template>
