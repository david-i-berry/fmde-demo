<script setup lang="ts">
// FMDE abstract test suite results for one node, grouped by conformance class.
import { atsLink, CODE_INFO, type AtsResult, type AtsStatus } from '@nodal/model'
import { computed } from 'vue'

const props = defineProps<{ results: AtsResult[] }>()

const STATUS: Record<AtsStatus, { label: string; color?: string; icon: string; help: string }> = {
  pass: { label: 'Pass', color: 'success', icon: 'mdi-check-circle-outline', help: 'No issue found' },
  fail: { label: 'Fail', color: 'error', icon: 'mdi-close-circle-outline', help: 'At least one requirement is not met' },
  warning: { label: 'Warning', color: 'warning', icon: 'mdi-alert-outline', help: 'Only warnings: the ATS and the requirements disagree, or a hub heuristic' },
  'not-run': { label: 'Not run', icon: 'mdi-minus-circle-outline', help: 'Nothing to test yet (no metadata, or no data messages in the window)' },
  network: { label: 'Not automated', icon: 'mdi-web-off', help: 'Needs an HTTP request to an external URI; not run in the browser' },
  'not-applicable': { label: 'N/A', icon: 'mdi-cancel', help: 'The ATS states this requirement is not applicable to ATS testing' },
}

const CLASS_TITLE: Record<string, string> = {
  'message-encoding': 'Message encoding',
  'parameter-standard-names': 'Parameter standard names',
  transmission: 'Transmission',
}

const groups = computed(() => {
  const out = new Map<string, AtsResult[]>()
  for (const r of props.results) out.set(r.test.cls, [...(out.get(r.test.cls) ?? []), r])
  return [...out.entries()]
})

const summary = computed(() => {
  const count = (s: AtsStatus) => props.results.filter((r) => r.status === s).length
  return { pass: count('pass'), fail: count('fail'), warning: count('warning') }
})

function codes(r: AtsResult) {
  const m = new Map<string, number>()
  for (const i of r.issues) m.set(i.code, (m.get(i.code) ?? 0) + 1)
  return [...m.entries()]
}
</script>

<template>
  <div>
    <div class="d-flex flex-wrap ga-2 mb-3 align-center">
      <v-chip color="success" variant="tonal" label prepend-icon="mdi-check-circle-outline">{{ summary.pass }} pass</v-chip>
      <v-chip color="error" variant="tonal" label prepend-icon="mdi-close-circle-outline">{{ summary.fail }} fail</v-chip>
      <v-chip color="warning" variant="tonal" label prepend-icon="mdi-alert-outline">{{ summary.warning }} warning</v-chip>
      <span class="text-caption text-medium-emphasis">FMDE abstract test suite (draft, wmo-im/fmde main)</span>
    </div>
    <v-card v-for="[cls, rows] in groups" :key="cls" variant="outlined" class="mb-3">
      <v-card-title class="text-subtitle-1">{{ CLASS_TITLE[cls] ?? cls }}</v-card-title>
      <v-table density="compact">
        <thead>
          <tr><th style="width: 120px">Result</th><th>Test</th><th>Findings</th></tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.test.id">
            <td>
              <v-chip :color="STATUS[r.status].color" :prepend-icon="STATUS[r.status].icon" size="small" variant="tonal" label :title="STATUS[r.status].help">
                {{ STATUS[r.status].label }}
              </v-chip>
            </td>
            <td class="py-2">
              <a :href="atsLink(r.test)" target="_blank" rel="noopener" class="font-weight-medium">{{ r.test.title }}</a>
              <div class="text-caption text-medium-emphasis">{{ r.test.id }} · {{ r.test.purpose }}</div>
              <div v-if="r.test.note" class="text-caption text-medium-emphasis font-italic">{{ r.test.note }}</div>
            </td>
            <td class="py-2">
              <div v-for="[code, n] in codes(r)" :key="code" class="mb-1">
                <v-chip size="x-small" :color="CODE_INFO[code as keyof typeof CODE_INFO].severity === 'error' ? 'error' : 'warning'" variant="tonal" label class="me-1">
                  {{ code }}{{ n > 1 ? ` × ${n}` : '' }}
                </v-chip>
                <span class="text-caption">{{ CODE_INFO[code as keyof typeof CODE_INFO].description }}</span>
                <div class="text-caption text-medium-emphasis">{{ CODE_INFO[code as keyof typeof CODE_INFO].requirement }}</div>
              </div>
            </td>
          </tr>
        </tbody>
      </v-table>
    </v-card>
  </div>
</template>
