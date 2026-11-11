<script setup lang="ts">
defineProps<{ text: string; maxHeight?: number }>()
</script>

<template>
  <pre class="nodal-textproto" :style="{ maxHeight: `${maxHeight ?? 420}px` }">{{ text }}</pre>
</template>

<style scoped>
.nodal-textproto {
  font-family: ui-monospace, 'Cascadia Code', Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.45;
  padding: 12px;
  overflow: auto;
  border-radius: 4px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  white-space: pre;
}
</style>
