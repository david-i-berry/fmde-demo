// Site view data: which nodes are on a site, and a node's track in the building.
import type { NetworkNode } from '@nodal/components'
import {
  calibrationOffset,
  extendReference,
  heightInBuilding,
  isMobile,
  isPressureReference,
  parseMeteoSwissCsv,
  positionParameters,
  positionSamples,
  positionSeries,
  referenceSamples,
  siteForLocation,
  siteTrack,
  type MetadataVersion,
  type NodeHubConfig,
  type NodeKey,
  type ReferenceSample,
  type SiteBuilding,
  type SitePosition,
} from '@nodal/model'
import { computed, onScopeDispose, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'
import { SITES } from '../sites'
import { useTimeWindow } from '../stores/ui'
import { useNetwork } from './nodal'
import { useQuery } from './useQuery'

/** The site a node is on, from its metadata (nominal) location. */
export function siteOfNode(n: NetworkNode): SiteBuilding | null {
  const loc = n.metadata?.node.location
  return siteForLocation(SITES, loc?.latitude, loc?.longitude)
}

export function useSiteNodes(siteId: MaybeRefOrGetter<string>) {
  const { network } = useNetwork()
  const nodes = computed(() => network.value.filter((n) => siteOfNode(n)?.id === toValue(siteId)))
  return {
    nodes,
    mobile: computed(() => nodes.value.filter((n) => n.metadata && isMobile(n.metadata))),
    references: computed(() => nodes.value.filter((n) => n.metadata && isPressureReference(n.metadata))),
  }
}

/**
 * A node's positions in the building over the time window: its position series plus the pressure
 * reference's, combined by siteTrack (floor from pressure, smoothed, snapped to a level).
 */
export function useSiteTrack(site: MaybeRefOrGetter<SiteBuilding | undefined>, nodeKey: MaybeRefOrGetter<NodeKey | null>) {
  const w = useTimeWindow()
  const { network } = useNetwork()
  const { rows: configs } = useQuery<{ node_key: string; hub_config: NodeHubConfig }>(`select node_key, hub_config from node`)

  const node = computed(() => network.value.find((n) => n.status.nodeKey === toValue(nodeKey)) ?? null)
  const reference = computed<NetworkNode | null>(() => {
    const b = toValue(site)
    if (!b || !node.value) return null
    const configured = configs.value.find((c) => c.node_key === node.value!.status.nodeKey)?.hub_config.pressureReference
    if (configured) return network.value.find((n) => n.status.nodeKey === configured) ?? null
    return network.value.find((n) => n.status.nodeKey !== node.value!.status.nodeKey && n.metadata && isPressureReference(n.metadata) && siteOfNode(n)?.id === b.id) ?? null
  })

  const series = (md: MetadataVersion | null | undefined) => (md ? positionSeries(md) : [])
  const keys = computed(() => [...series(node.value?.metadata), ...series(reference.value?.metadata)])
  const { rows } = useQuery<{ series_key: string; obs_time: Date; value_num: number | null }>(
    () =>
      keys.value.length
        ? `select series_key, obs_time, value_num from observation
           where series_key = any($1::text[]) and obs_time >= $2 and obs_time < $3 order by obs_time`
        : null,
    () => [keys.value, w.from.value, w.to.value],
  )

  // No reference node: the site's external reference (an official station's QFE, e.g. MeteoSwiss),
  // fetched from the browser (open data, CORS allowed) every 5 minutes while the view is open.
  const externalConfig = computed(() => (!reference.value ? (toValue(site)?.pressureReference ?? null) : null))
  const externalSamples = ref<ReferenceSample[]>([])
  const externalError = ref<string | null>(null)
  async function loadExternal() {
    const cfg = externalConfig.value
    if (!cfg) return
    try {
      const res = await fetch(cfg.url, { cache: 'no-cache' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      externalSamples.value = parseMeteoSwissCsv(await res.text())
      externalError.value = null
    } catch (e) {
      externalError.value = `${cfg.name}: ${e instanceof Error ? e.message : String(e)}`
    }
  }
  watch(() => externalConfig.value?.url, () => void loadExternal(), { immediate: true })
  const timer = setInterval(() => void loadExternal(), 5 * 60_000)
  onScopeDispose(() => clearInterval(timer))
  const externalReference = computed(() => (externalConfig.value && externalSamples.value.length ? externalConfig.value : null))

  const track = computed<SitePosition[]>(() => {
    const b = toValue(site)
    const md = node.value?.metadata
    if (!b || !md) return []
    const all = rows.value.map((r) => ({ seriesKey: r.series_key, time: r.obs_time.toISOString(), value: r.value_num }))
    const nodeKeys = new Set(series(md))
    const ext = externalReference.value
    if (ext) {
      // carried forward along its trend: the newest 10-minute values arrive 10-20 min late
      const refs = extendReference(externalSamples.value, w.to.value.getTime())
      const nodeOffset = calibrationOffset(configs.value.find((c) => c.node_key === node.value?.status.nodeKey)?.hub_config, positionParameters(md).pressure)
      const samples = positionSamples(positionParameters(md), all.filter((r) => nodeKeys.has(r.seriesKey))).map((s) =>
        s.pressure === undefined ? s : { ...s, pressure: s.pressure + nodeOffset },
      )
      return siteTrack(b, samples, refs, { refHeight: heightInBuilding(b, { heightMetres: ext.heightMetres, referenceSurface: 'MSL' }), nominal: md.node.location })
    }
    const refMd = reference.value?.metadata
    // calibrated pressures: a 1 hPa sensor offset is ~8 m of height (hub configuration, calibration)
    const config = (n: NetworkNode | null | undefined) => configs.value.find((c) => c.node_key === n?.status.nodeKey)?.hub_config
    const nodeOffset = calibrationOffset(config(node.value), positionParameters(md).pressure)
    const refOffset = refMd ? calibrationOffset(config(reference.value), positionParameters(refMd).pressure) : 0
    const samples = positionSamples(positionParameters(md), all.filter((r) => nodeKeys.has(r.seriesKey))).map((s) =>
      s.pressure === undefined ? s : { ...s, pressure: s.pressure + nodeOffset },
    )
    const refs = (refMd ? referenceSamples(positionParameters(refMd), all.filter((r) => !nodeKeys.has(r.seriesKey))) : []).map((r) => ({ ...r, pressure: r.pressure + refOffset }))
    return siteTrack(b, samples, refs, { refHeight: heightInBuilding(b, refMd?.node.location), nominal: md.node.location })
  })

  return { node, reference, externalReference, externalError, track }
}
