<script setup lang="ts">
import { NodalTopologyGraph } from '@nodal/components'
import type { NodeKey } from '@nodal/model'
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useTheme } from 'vuetify'
import { useNetwork } from '../composables/nodal'
import { useUiStore } from '../stores/ui'

const router = useRouter()
const theme = useTheme()
const dark = computed(() => theme.current.value.dark)
const { network, extras } = useNetwork()
const ui = useUiStore()

function open(nodeKey: NodeKey) {
  const [group, node] = nodeKey.split('/')
  void router.push({ name: 'node', params: { group, node }, query: router.currentRoute.value.query })
}
</script>

<template>
  <div class="d-flex align-baseline ga-3 mb-3 flex-wrap">
    <h1 class="text-h5">Topology</h1>
    <span class="text-body-2 text-medium-emphasis">Hub → broker → group → node → observer device → parameters. Click a node to open it.</span>
    <v-spacer />
    <v-switch
      v-model="ui.prefs.showNeverSeen"
      label="Show never-seen nodes"
      color="primary"
      density="compact"
      hide-details
      title="Nodes with retained metadata but no data message yet"
      @update:model-value="ui.savePrefs()"
    />
  </div>
  <NodalTopologyGraph :network="network" :extras="extras" :dark="dark" height="calc(100vh - 210px)" @select:node="open" />
</template>
