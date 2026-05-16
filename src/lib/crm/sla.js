/**
 * CRM — SLA Engine and CSAT (Customer Satisfaction)
 */

// ============================================================
// SLA Engine
// ============================================================

export const SLA_POLICIES = [
  { priority: '緊急', response_hours: 1, resolution_hours: 4, label: '緊急 SLA' },
  { priority: '高', response_hours: 4, resolution_hours: 24, label: '高優先 SLA' },
  { priority: '一般', response_hours: 8, resolution_hours: 48, label: '一般 SLA' },
  { priority: '低', response_hours: 24, resolution_hours: 72, label: '低優先 SLA' },
]

/**
 * Calculate SLA status for a ticket
 */
export function calculateSLAStatus(ticket) {
  const policy = SLA_POLICIES.find(p => p.priority === ticket.priority) || SLA_POLICIES[2]
  const createdAt = new Date(ticket.created_at)
  const now = ticket.resolved_at ? new Date(ticket.resolved_at) : new Date()
  const hoursElapsed = (now - createdAt) / (1000 * 60 * 60)

  const responseDeadline = new Date(createdAt.getTime() + policy.response_hours * 60 * 60 * 1000)
  const resolutionDeadline = new Date(createdAt.getTime() + policy.resolution_hours * 60 * 60 * 1000)

  const isResolved = ['已解決', '已關閉'].includes(ticket.status)
  const responseBreached = !ticket.first_response_at && now > responseDeadline
  const resolutionBreached = !isResolved && now > resolutionDeadline

  let status = 'on_track' // on_track, warning, breached
  if (resolutionBreached || responseBreached) status = 'breached'
  else if (hoursElapsed > policy.resolution_hours * 0.75) status = 'warning'

  return {
    status,
    policy,
    hoursElapsed: Math.round(hoursElapsed * 10) / 10,
    responseDeadline,
    resolutionDeadline,
    responseBreached,
    resolutionBreached,
    remainingHours: Math.max(0, Math.round((policy.resolution_hours - hoursElapsed) * 10) / 10),
  }
}

/**
 * Auto-assign ticket using round-robin
 */
export function autoAssignTicket(agents, tickets) {
  if (!agents.length) return null
  const assignCounts = {}
  agents.forEach(a => { assignCounts[a] = 0 })
  tickets.filter(t => !['已解決', '已關閉'].includes(t.status)).forEach(t => {
    if (t.assignee && assignCounts[t.assignee] !== undefined) assignCounts[t.assignee]++
  })
  return agents.reduce((min, a) => (assignCounts[a] < assignCounts[min] ? a : min), agents[0])
}

/**
 * Check if ticket should be escalated
 */
export function checkEscalation(ticket) {
  const sla = calculateSLAStatus(ticket)
  const escalations = []
  if (sla.responseBreached) escalations.push({ type: 'response', message: `回應 SLA 已逾期（${sla.policy.response_hours}小時）` })
  if (sla.resolutionBreached) escalations.push({ type: 'resolution', message: `解決 SLA 已逾期（${sla.policy.resolution_hours}小時）` })
  if (sla.status === 'warning') escalations.push({ type: 'warning', message: `即將逾期（剩餘 ${sla.remainingHours} 小時）` })
  return escalations
}

// ============================================================
// CSAT (Customer Satisfaction)
// ============================================================

/**
 * Create CSAT survey for resolved ticket
 */
export function createCSATSurvey(ticketId, customerId) {
  return {
    id: `CSAT-${Date.now()}`,
    ticket_id: ticketId,
    customer_id: customerId,
    score: null, // 1-5
    comment: '',
    created_at: new Date().toISOString(),
    responded_at: null,
  }
}

/**
 * Calculate CSAT metrics
 */
export function calculateCSATMetrics(surveys) {
  const responded = surveys.filter(s => s.score !== null)
  if (responded.length === 0) return { avg: 0, count: 0, responseRate: 0, distribution: {} }

  const avg = responded.reduce((s, r) => s + r.score, 0) / responded.length
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  responded.forEach(s => { distribution[s.score] = (distribution[s.score] || 0) + 1 })

  return {
    avg: Math.round(avg * 10) / 10,
    count: responded.length,
    responseRate: Math.round((responded.length / surveys.length) * 100),
    distribution,
    satisfiedRate: Math.round((responded.filter(s => s.score >= 4).length / responded.length) * 100),
  }
}
