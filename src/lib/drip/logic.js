import { TRIGGER_TYPES, STEP_TYPES } from './types'

// ── 工具：產生唯一 ID ──
function generateId(prefix = 'drip') {
  const ts = Date.now().toString(36)
  const rand = Math.random().toString(36).substring(2, 8)
  return `${prefix}_${ts}_${rand}`
}

// ── 工具：計算延遲毫秒數 ──
function delayToMs(step) {
  const days = step.delay_days || 0
  const hours = step.delay_hours || 0
  return (days * 24 + hours) * 60 * 60 * 1000
}

// ══════════════════════════════════════════════
// 1. 建立滴灌行銷活動
// ══════════════════════════════════════════════
/**
 * 建立新的滴灌行銷活動
 * @param {Object} config - 活動設定
 * @param {string} config.name - 活動名稱
 * @param {string} config.description - 活動說明
 * @param {string} config.trigger - 觸發類型 (見 TRIGGER_TYPES)
 * @param {Object} config.audience - 受眾條件篩選
 * @param {Array}  config.steps - 行銷步驟陣列
 * @param {string} config.status - 狀態 (draft / active / paused / completed)
 * @returns {Object} 含 id 與 created_at 的活動物件
 */
export function createDripCampaign(config) {
  const validTriggers = TRIGGER_TYPES.map((t) => t.id)
  if (!config.name || typeof config.name !== 'string') {
    throw new Error('活動名稱 (name) 為必填欄位')
  }
  if (config.trigger && !validTriggers.includes(config.trigger)) {
    throw new Error(`不支援的觸發類型: ${config.trigger}，可用: ${validTriggers.join(', ')}`)
  }

  return {
    id: generateId('campaign'),
    name: config.name,
    description: config.description || '',
    trigger: config.trigger || 'manual',
    audience: config.audience || {},
    steps: Array.isArray(config.steps) ? config.steps.map((s, i) => ({ ...s, step_index: i })) : [],
    status: config.status || 'draft',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    stats: {
      enrolled: 0,
      completed: 0,
      active: 0,
    },
  }
}

// ══════════════════════════════════════════════
// 2. 新增行銷步驟
// ══════════════════════════════════════════════
/**
 * 在活動中新增一個步驟
 * @param {Object} campaign - 活動物件 (會被淺拷貝，不會直接修改)
 * @param {Object} step - 步驟設定
 * @param {number} step.delay_days - 延遲天數
 * @param {number} step.delay_hours - 延遲小時數
 * @param {string} step.type - 步驟類型 (email / line / sms / wait / condition)
 * @param {string} step.template_id - 範本 ID
 * @param {string} step.subject - 郵件主旨 (email 適用)
 * @param {string} step.content - 內容
 * @param {Object} step.conditions - 條件設定 (condition 適用)
 * @returns {Array} 更新後的步驟陣列
 */
export function addDripStep(campaign, step) {
  const validTypes = STEP_TYPES.map((t) => t.id)
  if (!step.type || !validTypes.includes(step.type)) {
    throw new Error(`不支援的步驟類型: ${step.type}，可用: ${validTypes.join(', ')}`)
  }

  // 驗證 email 步驟需有主旨
  if (step.type === 'email' && !step.subject && !step.template_id) {
    throw new Error('email 步驟需提供 subject 或 template_id')
  }

  // 驗證 condition 步驟需有分支欄位
  if (step.type === 'condition') {
    if (!step.field || !step.operator) {
      throw new Error('condition 步驟需提供 field 與 operator')
    }
  }

  const newStep = {
    id: generateId('step'),
    step_index: campaign.steps.length,
    delay_days: step.delay_days || 0,
    delay_hours: step.delay_hours || 0,
    type: step.type,
    template_id: step.template_id || null,
    subject: step.subject || null,
    content: step.content || null,
    // condition 專用欄位
    field: step.field || null,
    operator: step.operator || null,
    value: step.value !== undefined ? step.value : null,
    true_branch_step: step.true_branch_step || step.true_step || null,
    false_branch_step: step.false_branch_step || step.false_step || null,
    created_at: new Date().toISOString(),
  }

  const updatedSteps = [...campaign.steps, newStep]
  return updatedSteps
}

// ══════════════════════════════════════════════
// 3. 條件評估
// ══════════════════════════════════════════════
/**
 * 評估聯絡人是否符合條件
 * @param {Object} contact - 聯絡人資料
 * @param {Object} condition - 條件物件 { field, operator, value }
 *   field: 'opened_email' | 'clicked_link' | 'purchased' | 'visited_page' | 'tag_match' | 'custom_field'
 *   operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'not_contains' | 'in' | 'not_in'
 * @returns {boolean}
 */
export function evaluateDripCondition(contact, condition) {
  if (!condition || !condition.field || !condition.operator) {
    return false
  }

  const { field, operator, value } = condition

  // 取得聯絡人上對應欄位的值
  let contactValue

  switch (field) {
    case 'opened_email':
      contactValue = contact.opened_email ?? contact.email_opened ?? false
      break

    case 'clicked_link':
      contactValue = contact.clicked_link ?? contact.link_clicked ?? false
      break

    case 'purchased':
      contactValue = contact.purchased ?? contact.has_purchase ?? false
      break

    case 'visited_page':
      contactValue = contact.visited_pages
        ? contact.visited_pages.includes(value)
        : contact.visited_page ?? false
      break

    case 'tag_match':
      contactValue = contact.tags || []
      break

    case 'custom_field':
      if (typeof value === 'string' && value.includes(':')) {
        const [cfName, cfExpected] = value.split(':')
        contactValue = contact[cfName] ?? contact.custom_fields?.[cfName]
        return compareValues(contactValue, operator, cfExpected)
      }
      contactValue = contact[field]
      break

    default:
      contactValue = contact[field] ?? contact.custom_fields?.[field]
      break
  }

  return compareValues(contactValue, operator, value)
}

/**
 * 比較運算
 * @param {*} actual - 實際值
 * @param {string} operator - 運算子
 * @param {*} expected - 期望值
 * @returns {boolean}
 */
function compareValues(actual, operator, expected) {
  switch (operator) {
    case 'eq':
      return actual === expected || String(actual) === String(expected)

    case 'neq':
      return actual !== expected && String(actual) !== String(expected)

    case 'gt':
      return Number(actual) > Number(expected)

    case 'gte':
      return Number(actual) >= Number(expected)

    case 'lt':
      return Number(actual) < Number(expected)

    case 'lte':
      return Number(actual) <= Number(expected)

    case 'contains':
      if (Array.isArray(actual)) return actual.includes(expected)
      return String(actual).includes(String(expected))

    case 'not_contains':
      if (Array.isArray(actual)) return !actual.includes(expected)
      return !String(actual).includes(String(expected))

    case 'in':
      if (Array.isArray(expected)) return expected.includes(actual)
      return String(expected).includes(String(actual))

    case 'not_in':
      if (Array.isArray(expected)) return !expected.includes(actual)
      return !String(expected).includes(String(actual))

    default:
      return false
  }
}

// ══════════════════════════════════════════════
// 4. 活動模擬
// ══════════════════════════════════════════════
/**
 * 模擬滴灌行銷活動的執行流程
 * @param {Object} campaign - 活動物件
 * @param {Array} sampleContacts - 模擬用聯絡人清單
 * @returns {Object} { timeline, stats }
 */
export function simulateDripCampaign(campaign, sampleContacts) {
  if (!campaign || !Array.isArray(campaign.steps) || campaign.steps.length === 0) {
    return {
      timeline: [],
      stats: { total_contacts: 0, emails_to_send: 0, estimated_duration_days: 0 },
    }
  }

  const contacts = sampleContacts || []
  const timeline = []
  let maxDurationMs = 0

  for (const contact of contacts) {
    let cumulativeDelayMs = 0

    for (const step of campaign.steps) {
      const stepDelayMs = delayToMs(step)
      cumulativeDelayMs += stepDelayMs
      const scheduledAt = new Date(Date.now() + cumulativeDelayMs).toISOString()

      if (step.type === 'condition') {
        const conditionMet = evaluateDripCondition(contact, {
          field: step.field,
          operator: step.operator,
          value: step.value,
        })

        const branchStep = conditionMet
          ? (step.true_branch_step || step.true_step)
          : (step.false_branch_step || step.false_step)

        timeline.push({
          contact_id: contact.id || contact.email,
          contact_name: contact.name || contact.customer_name || '未知',
          step_index: step.step_index,
          step_type: 'condition',
          condition_result: conditionMet,
          scheduled_at: scheduledAt,
          action: conditionMet ? '條件成立 → 走 true 分支' : '條件不成立 → 走 false 分支',
        })

        if (branchStep) {
          timeline.push({
            contact_id: contact.id || contact.email,
            contact_name: contact.name || contact.customer_name || '未知',
            step_index: step.step_index,
            step_type: branchStep.type,
            subject: branchStep.subject || null,
            content_preview: branchStep.content
              ? branchStep.content.substring(0, 60) + '...'
              : null,
            scheduled_at: scheduledAt,
            action: `發送${STEP_TYPES.find((t) => t.id === branchStep.type)?.name || branchStep.type}`,
          })
        }
      } else if (step.type === 'wait') {
        timeline.push({
          contact_id: contact.id || contact.email,
          contact_name: contact.name || contact.customer_name || '未知',
          step_index: step.step_index,
          step_type: 'wait',
          scheduled_at: scheduledAt,
          action: `等待 ${step.delay_days || 0} 天 ${step.delay_hours || 0} 小時`,
        })
      } else {
        timeline.push({
          contact_id: contact.id || contact.email,
          contact_name: contact.name || contact.customer_name || '未知',
          step_index: step.step_index,
          step_type: step.type,
          subject: step.subject || null,
          content_preview: step.content ? step.content.substring(0, 60) + '...' : null,
          scheduled_at: scheduledAt,
          action: `發送${STEP_TYPES.find((t) => t.id === step.type)?.name || step.type}`,
        })
      }

      if (cumulativeDelayMs > maxDurationMs) {
        maxDurationMs = cumulativeDelayMs
      }
    }
  }

  const emailActions = timeline.filter((t) => t.step_type === 'email')
  const estimatedDurationDays = Math.ceil(maxDurationMs / (1000 * 60 * 60 * 24))

  return {
    timeline,
    stats: {
      total_contacts: contacts.length,
      emails_to_send: emailActions.length,
      line_messages: timeline.filter((t) => t.step_type === 'line').length,
      sms_messages: timeline.filter((t) => t.step_type === 'sms').length,
      condition_branches: timeline.filter((t) => t.step_type === 'condition').length,
      estimated_duration_days: estimatedDurationDays,
    },
  }
}

// ══════════════════════════════════════════════
// 5. 成效指標計算
// ══════════════════════════════════════════════
/**
 * 計算滴灌活動的績效指標
 * @param {Object} campaign - 活動物件
 * @param {Array} history - 歷史紀錄 [{contact_id, step_index, event, timestamp, revenue?}]
 *   event: 'sent' | 'delivered' | 'opened' | 'clicked' | 'converted' | 'unsubscribed' | 'bounced'
 * @returns {Object} 績效指標
 */
export function calculateDripMetrics(campaign, history) {
  if (!Array.isArray(history) || history.length === 0) {
    return {
      sent: 0,
      delivered: 0,
      opened: 0,
      clicked: 0,
      converted: 0,
      unsubscribed: 0,
      bounced: 0,
      open_rate: 0,
      click_rate: 0,
      conversion_rate: 0,
      unsubscribe_rate: 0,
      bounce_rate: 0,
      revenue_attributed: 0,
      avg_revenue_per_conversion: 0,
      step_metrics: [],
    }
  }

  const sent = history.filter((h) => h.event === 'sent').length
  const delivered = history.filter((h) => h.event === 'delivered').length
  const opened = history.filter((h) => h.event === 'opened').length
  const clicked = history.filter((h) => h.event === 'clicked').length
  const converted = history.filter((h) => h.event === 'converted').length
  const unsubscribed = history.filter((h) => h.event === 'unsubscribed').length
  const bounced = history.filter((h) => h.event === 'bounced').length

  const revenueAttributed = history
    .filter((h) => h.event === 'converted' && h.revenue)
    .reduce((sum, h) => sum + Number(h.revenue), 0)

  const deliveredBase = delivered || sent || 1

  const stepIndices = [...new Set(history.map((h) => h.step_index).filter((i) => i !== undefined))]
  const stepMetrics = stepIndices.map((idx) => {
    const stepHistory = history.filter((h) => h.step_index === idx)
    const sSent = stepHistory.filter((h) => h.event === 'sent').length
    const sDelivered = stepHistory.filter((h) => h.event === 'delivered').length
    const sOpened = stepHistory.filter((h) => h.event === 'opened').length
    const sClicked = stepHistory.filter((h) => h.event === 'clicked').length
    const sBase = sDelivered || sSent || 1

    const stepInfo = campaign?.steps?.[idx]

    return {
      step_index: idx,
      step_type: stepInfo?.type || null,
      subject: stepInfo?.subject || null,
      sent: sSent,
      delivered: sDelivered,
      opened: sOpened,
      clicked: sClicked,
      open_rate: Math.round((sOpened / sBase) * 10000) / 100,
      click_rate: Math.round((sClicked / sBase) * 10000) / 100,
    }
  })

  return {
    sent,
    delivered,
    opened,
    clicked,
    converted,
    unsubscribed,
    bounced,
    open_rate: Math.round((opened / deliveredBase) * 10000) / 100,
    click_rate: Math.round((clicked / deliveredBase) * 10000) / 100,
    conversion_rate: Math.round((converted / deliveredBase) * 10000) / 100,
    unsubscribe_rate: Math.round((unsubscribed / sent || 1) * 10000) / 100,
    bounce_rate: Math.round((bounced / sent || 1) * 10000) / 100,
    revenue_attributed: revenueAttributed,
    avg_revenue_per_conversion: converted > 0 ? Math.round(revenueAttributed / converted) : 0,
    step_metrics: stepMetrics,
  }
}
