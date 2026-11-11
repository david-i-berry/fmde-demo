// Building models for the site view: every data/sites/*.building.json.
// VITE_SITES=off at build time (the GitHub Pages build, fmde-demo) leaves them out: no site view, no building data.
import { siteFootprint, type SiteBuilding } from '@nodal/model'
import type { MapSite } from '@nodal/components'

const files: Record<string, SiteBuilding> =
  import.meta.env.VITE_SITES === 'off' ? {} : import.meta.glob<SiteBuilding>('../../../data/sites/*.building.json', { eager: true, import: 'default' })

export const SITES: SiteBuilding[] = Object.values(files).sort((a, b) => a.name.localeCompare(b.name))

export const siteById = (id: string): SiteBuilding | undefined => SITES.find((s) => s.id === id)

export const MAP_SITES: MapSite[] = SITES.map((s) => ({ id: s.id, name: s.name, footprint: siteFootprint(s) }))
