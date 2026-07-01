import { getRoutingRules } from '../db/dispatch'

// Evaluates routing rules in priority order; returns first matching action object
export async function selectCarrier(orgId, order) {
  const { data: rules } = await getRoutingRules(orgId)
  if (!rules?.length) return null
  for (const rule of rules) {
    if (matchesConditions(rule.conditions, order)) return rule.action
  }
  return null
}

function matchesConditions(conditions = {}, order = {}) {
  const { zone, weight_max, weight_min, sla_hours, order_value_max, order_value_min } = conditions

  if (zone) {
    const zones = Array.isArray(zone) ? zone : [zone]
    const postalStr = (order.postal_code ?? '').toString()
    if (!zones.some(z => postalStr.startsWith(z.toString()))) return false
  }
  if (weight_max != null && (order.weight_kg ?? 0) > weight_max) return false
  if (weight_min != null && (order.weight_kg ?? 0) < weight_min) return false
  if (order_value_max != null && (order.order_value ?? 0) > order_value_max) return false
  if (order_value_min != null && (order.order_value ?? 0) < order_value_min) return false
  if (sla_hours != null && (order.sla_hours ?? 999) > sla_hours) return false
  return true
}

// Returns ISO timestamptz for SLA deadline
export function calcSLADeadline(slaHours = 48, fromDate = new Date()) {
  const d = new Date(fromDate)
  d.setHours(d.getHours() + slaHours)
  return d.toISOString()
}

// Generate unique job number DSP-YYYYMMDD-XXXX
export function generateJobNumber() {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const rand = Math.floor(1000 + Math.random() * 9000)
  return `DSP-${d}-${rand}`
}

// Generate unique route number RTE-YYYYMMDD-XX
export function generateRouteNumber() {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const rand = Math.floor(10 + Math.random() * 90)
  return `RTE-${d}-${rand}`
}
