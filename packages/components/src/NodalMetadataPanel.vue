<script setup lang="ts">
import type { Location, MetadataVersion } from '@nodal/model'
import { formatTime } from './format'

defineProps<{ metadata: MetadataVersion; utc?: boolean }>()

function loc(l?: Location): string {
  if (!l) return '—'
  const pos = l.latitude !== undefined && l.longitude !== undefined ? `${l.latitude.toFixed(5)}, ${l.longitude.toFixed(5)}` : 'no position'
  return `${pos} · ${l.heightMetres} m above ${l.referenceSurface}`
}
</script>

<template>
  <v-card variant="outlined">
    <v-card-title class="d-flex align-center ga-2 flex-wrap">
      <v-icon icon="mdi-router-wireless" />
      {{ metadata.node.name || metadata.node.nodeId }}
      <v-chip size="x-small" label>metadata v{{ metadata.version }}</v-chip>
    </v-card-title>
    <v-card-subtitle>{{ metadata.node.topic }}</v-card-subtitle>
    <v-card-text>
      <v-table density="compact">
        <tbody>
          <tr><th>Serial number</th><td>{{ metadata.node.serialNumber ?? '—' }}</td></tr>
          <tr><th>Firmware</th><td>{{ metadata.node.firmwareVersion ?? '—' }}</td></tr>
          <tr><th>Location</th><td>{{ loc(metadata.node.location) }}</td></tr>
          <tr v-if="metadata.node.url"><th>URL</th><td><a :href="metadata.node.url" target="_blank" rel="noopener">{{ metadata.node.url }}</a></td></tr>
          <tr><th>Metadata received</th><td>{{ formatTime(metadata.receivedAt, utc ?? true) }} · {{ metadata.rawBytes }} bytes</td></tr>
        </tbody>
      </v-table>

      <div class="text-subtitle-2 mt-4 mb-1">Observer devices</div>
      <v-table density="compact">
        <thead><tr><th>ID</th><th>Name</th><th>Serial</th><th>Firmware</th><th>Location</th></tr></thead>
        <tbody>
          <tr v-for="o in metadata.observers" :key="o.id">
            <td>{{ o.id }}</td><td>{{ o.name }}</td><td>{{ o.serialNumber ?? '—' }}</td><td>{{ o.firmwareVersion ?? '—' }}</td><td>{{ loc(o.location) }}</td>
          </tr>
          <tr v-if="metadata.observers.length === 0"><td colspan="5" class="text-medium-emphasis">None declared</td></tr>
        </tbody>
      </v-table>
    </v-card-text>
  </v-card>
</template>
