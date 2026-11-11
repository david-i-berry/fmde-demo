// Node-health parameters. FMDE has no standard names for them, so they come from
// the hub configuration's healthParamMap, or else a heuristic on longName and unit.
import type { MetadataVersion, NodeHubConfig, Parameter } from './types'

export type HealthQuantity = 'batteryVoltage' | 'solarVoltage' | 'loggerTemperature'

const HEURISTICS: Record<HealthQuantity, { name: RegExp; units: string[] }> = {
  batteryVoltage: { name: /batter/i, units: ['V'] },
  solarVoltage: { name: /solar|panel/i, units: ['V'] },
  loggerTemperature: { name: /(logger|internal).*temp/i, units: ['°C', '˚C', 'Cel', 'degC'] },
}

/** The node-level parameter for a health quantity, if one is identifiable. */
export function healthParameter(metadata: MetadataVersion, quantity: HealthQuantity, hubConfig?: NodeHubConfig): Parameter | null {
  const mapped = hubConfig?.healthParamMap?.[quantity]
  if (mapped) return metadata.parameters.find((p) => p.seriesKey === mapped) ?? null
  const h = HEURISTICS[quantity]
  return metadata.parameters.find((p) => p.device.kind === 'node' && h.name.test(p.longName) && h.units.includes(p.unit)) ?? null
}
