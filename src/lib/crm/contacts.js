/**
 * CRM — Contact ↔ Company model, duplicate detection, and unsubscribe management
 */

// ============================================================
// Contact ↔ Company (Account) Model
// ============================================================

/**
 * Create a company (account) record
 */
export function createCompanyRecord(data) {
  return {
    id: data.id || `COM-${Date.now()}`,
    name: data.name || '',
    industry: data.industry || '',
    size: data.size || '', // 微型, 小型, 中型, 大型
    website: data.website || '',
    address: data.address || '',
    tax_id: data.tax_id || '', // 統一編號
    phone: data.phone || '',
    annual_revenue: data.annual_revenue || 0,
    employee_count: data.employee_count || 0,
    owner: data.owner || '',
    notes: data.notes || '',
    created_at: data.created_at || new Date().toISOString(),
  }
}

/**
 * Link a contact to a company with a role
 */
export function linkContactToCompany(contactId, companyId, role = '聯絡人') {
  const ROLES = ['決策者', '影響者', '聯絡人', '採購', '技術負責人', '財務負責人', '其他']
  return {
    contact_id: contactId,
    company_id: companyId,
    role: ROLES.includes(role) ? role : '聯絡人',
    is_primary: false,
    created_at: new Date().toISOString(),
  }
}

/**
 * Get all contacts for a company
 */
export function getCompanyContacts(contacts, companyLinks, companyId) {
  const linkIds = companyLinks.filter(l => l.company_id === companyId).map(l => l.contact_id)
  return contacts.filter(c => linkIds.includes(c.id))
}

// ============================================================
// Duplicate Detection
// ============================================================

/**
 * Find potential duplicate contacts
 */
export function findDuplicates(customers) {
  const duplicates = []
  for (let i = 0; i < customers.length; i++) {
    for (let j = i + 1; j < customers.length; j++) {
      const a = customers[i], b = customers[j]
      let score = 0
      const reasons = []

      // Exact phone match
      if (a.phone && b.phone && a.phone === b.phone) { score += 40; reasons.push('電話相同') }
      // Exact email match
      if (a.email && b.email && a.email.toLowerCase() === b.email.toLowerCase()) { score += 40; reasons.push('Email相同') }
      // Same name + company
      if (a.name && b.name && a.name === b.name) { score += 30; reasons.push('姓名相同') }
      if (a.company && b.company && a.company === b.company) { score += 20; reasons.push('公司相同') }

      if (score >= 40) {
        duplicates.push({ customerA: a, customerB: b, score: Math.min(100, score), reasons })
      }
    }
  }
  return duplicates.sort((a, b) => b.score - a.score)
}

// ============================================================
// Unsubscribe Management (個資法 Compliance)
// ============================================================

/**
 * Check if a customer has unsubscribed from a channel
 */
export function isUnsubscribed(unsubscribeList, customerId, channel = 'all') {
  return unsubscribeList.some(u =>
    u.customer_id === customerId && (u.channel === 'all' || u.channel === channel || channel === 'all')
  )
}

/**
 * Create unsubscribe record
 */
export function createUnsubscribeRecord(customerId, channel, reason = '') {
  return {
    id: `UNSUB-${Date.now()}`,
    customer_id: customerId,
    channel, // 'email', 'sms', 'line', 'all'
    reason,
    created_at: new Date().toISOString(),
  }
}

/**
 * Filter recipients by unsubscribe status
 */
export function filterUnsubscribed(recipients, unsubscribeList, channel) {
  return recipients.filter(r => !isUnsubscribed(unsubscribeList, r.id || r.customer_id, channel))
}
