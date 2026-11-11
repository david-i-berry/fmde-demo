<script setup lang="ts">
import type { Conformance } from '@nodal/model'
import { computed } from 'vue'
import { CONFORMANCE_META } from './state'

const props = withDefaults(defineProps<{ conformance: Conformance; size?: 'x-small' | 'small' | 'default' }>(), { size: 'small' })
const meta = computed(() => CONFORMANCE_META[props.conformance])
</script>

<template>
  <v-chip :color="meta.color" :size="size" :prepend-icon="meta.icon" variant="outlined" label :title="meta.description">
    {{ meta.label }}
  </v-chip>
</template>
