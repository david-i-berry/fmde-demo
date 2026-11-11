import { computed, onScopeDispose, ref, shallowRef, toValue, watch, type MaybeRefOrGetter } from 'vue'
import { getDb, onDataChange } from '../db/client'

/**
 * Run a query and re-run it when its SQL or params change, or when ingest writes (NOTIFY,
 * throttled). Works for metric functions, which PGlite live queries cannot track.
 * Results are held in a shallowRef: never deep-reactive.
 */
export function useQuery<Row, Out = Row>(
  sql: MaybeRefOrGetter<string | null>,
  params: MaybeRefOrGetter<unknown[]> = [],
  map?: (rows: Row[]) => Out[],
) {
  const rows = shallowRef<Out[]>([])
  const loading = ref(true)
  const error = ref<string | null>(null)
  let seq = 0

  async function run() {
    const text = toValue(sql)
    if (!text) return
    const id = ++seq
    try {
      const db = await getDb()
      const res = await db.query<Row>(text, toValue(params))
      if (id !== seq) return
      rows.value = map ? map(res.rows) : (res.rows as unknown as Out[])
      error.value = null
    } catch (e) {
      if (id === seq) error.value = e instanceof Error ? e.message : String(e)
    } finally {
      if (id === seq) loading.value = false
    }
  }

  const key = computed(() => JSON.stringify([toValue(sql), toValue(params)]))
  watch(key, run, { immediate: true })

  let timer: ReturnType<typeof setTimeout> | null = null
  const throttled = () => {
    timer ??= setTimeout(() => {
      timer = null
      void run()
    }, 750)
  }
  let unsubscribe: (() => void) | null = null
  void onDataChange(throttled).then((u) => (unsubscribe = u))
  onScopeDispose(() => {
    unsubscribe?.()
    if (timer) clearTimeout(timer)
  })

  return { rows, loading, error, refresh: run }
}
