<script setup lang="ts">
import type { NodeState } from '@nodal/model'
import { computed } from 'vue'
import { STATE_META } from './state'

const props = withDefaults(defineProps<{ state: NodeState; size?: 'x-small' | 'small' | 'default' }>(), { size: 'small' })
const meta = computed(() => STATE_META[props.state])
</script>

<template>
  <v-chip :color="meta.color" :size="size" :prepend-icon="meta.icon" variant="tonal" label :title="meta.description">
    {{ meta.label }}
  </v-chip>
</template>
