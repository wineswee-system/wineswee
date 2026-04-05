/**
 * SME OPS 電子郵件滴灌行銷引擎 (Drip Campaign Engine)
 *
 * 功能:
 * 1. 建立與管理滴灌行銷活動
 * 2. 設定多步驟自動化序列 (email / LINE / SMS / 條件分支)
 * 3. 條件評估與分支邏輯
 * 4. 活動模擬與成效指標計算
 * 5. 預建台灣中小企業常用行銷範本
 */

// ── 觸發類型定義 ──
export const TRIGGER_TYPES = [
  {
    id: 'new_customer',
    name: '新客戶加入',
    nameEn: 'New Customer',
    description: '當新客戶完成註冊或首次加入會員時觸發',
    icon: '👤',
  },
  {
    id: 'abandoned_cart',
    name: '購物車放棄',
    nameEn: 'Abandoned Cart',
    description: '客戶將商品加入購物車但未完成結帳時觸發',
    icon: '🛒',
  },
  {
    id: 'post_purchase',
    name: '購買完成',
    nameEn: 'Post Purchase',
    description: '客戶完成訂單付款後觸發',
    icon: '✅',
  },
  {
    id: 'inactivity',
    name: '客戶沉睡',
    nameEn: 'Inactivity',
    description: '客戶超過指定天數未有任何互動時觸發',
    icon: '💤',
  },
  {
    id: 'birthday',
    name: '生日',
    nameEn: 'Birthday',
    description: '會員生日前指定天數自動觸發',
    icon: '🎂',
  },
  {
    id: 'subscription',
    name: '訂閱啟用',
    nameEn: 'Subscription',
    description: '客戶訂閱方案啟用或續約時觸發',
    icon: '📦',
  },
  {
    id: 'manual',
    name: '手動觸發',
    nameEn: 'Manual',
    description: '由行銷人員手動選擇名單並觸發',
    icon: '✋',
  },
]

// ── 步驟類型定義 ──
export const STEP_TYPES = [
  {
    id: 'email',
    name: '電子郵件',
    nameEn: 'Email',
    description: '發送電子郵件給目標聯絡人',
    fields: ['subject', 'content', 'template_id'],
  },
  {
    id: 'line',
    name: 'LINE 訊息',
    nameEn: 'LINE Message',
    description: '透過 LINE 官方帳號推送訊息',
    fields: ['content', 'template_id'],
  },
  {
    id: 'sms',
    name: '簡訊',
    nameEn: 'SMS',
    description: '發送手機簡訊',
    fields: ['content'],
  },
  {
    id: 'wait',
    name: '等待',
    nameEn: 'Wait',
    description: '等待指定時間後再執行下一步',
    fields: ['delay_days', 'delay_hours'],
  },
  {
    id: 'condition',
    name: '條件分支',
    nameEn: 'Condition',
    description: '根據條件判斷走不同分支流程',
    fields: ['field', 'operator', 'value', 'true_branch_step', 'false_branch_step'],
  },
]

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
      // 是否曾開啟過郵件
      contactValue = contact.opened_email ?? contact.email_opened ?? false
      break

    case 'clicked_link':
      // 是否曾點擊連結
      contactValue = contact.clicked_link ?? contact.link_clicked ?? false
      break

    case 'purchased':
      // 是否已完成購買
      contactValue = contact.purchased ?? contact.has_purchase ?? false
      break

    case 'visited_page':
      // 是否訪問過指定頁面
      contactValue = contact.visited_pages
        ? contact.visited_pages.includes(value)
        : contact.visited_page ?? false
      break

    case 'tag_match':
      // 標籤匹配
      contactValue = contact.tags || []
      break

    case 'custom_field':
      // 自訂欄位：以 value 格式 "field_name:expected" 解析
      if (typeof value === 'string' && value.includes(':')) {
        const [cfName, cfExpected] = value.split(':')
        contactValue = contact[cfName] ?? contact.custom_fields?.[cfName]
        // 重新將 value 設定為期望值以統一比較
        return compareValues(contactValue, operator, cfExpected)
      }
      contactValue = contact[field]
      break

    default:
      // 嘗試直接從 contact 物件取值
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
        // 評估條件，走對應分支
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

        // 若分支步驟存在，追加到 timeline
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
        // 等待步驟不產生動作，只累計時間
        timeline.push({
          contact_id: contact.id || contact.email,
          contact_name: contact.name || contact.customer_name || '未知',
          step_index: step.step_index,
          step_type: 'wait',
          scheduled_at: scheduledAt,
          action: `等待 ${step.delay_days || 0} 天 ${step.delay_hours || 0} 小時`,
        })
      } else {
        // email / line / sms
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

  // 計算統計
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
      // 每步驟分析
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

  // 基數使用 delivered（若無則用 sent）避免除以零
  const deliveredBase = delivered || sent || 1

  // 每步驟績效分析
  const stepIndices = [...new Set(history.map((h) => h.step_index).filter((i) => i !== undefined))]
  const stepMetrics = stepIndices.map((idx) => {
    const stepHistory = history.filter((h) => h.step_index === idx)
    const sSent = stepHistory.filter((h) => h.event === 'sent').length
    const sDelivered = stepHistory.filter((h) => h.event === 'delivered').length
    const sOpened = stepHistory.filter((h) => h.event === 'opened').length
    const sClicked = stepHistory.filter((h) => h.event === 'clicked').length
    const sBase = sDelivered || sSent || 1

    // 嘗試從 campaign 取得步驟資訊
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

// ══════════════════════════════════════════════
// 6. 預建行銷活動範本
// ══════════════════════════════════════════════
export const DRIP_TEMPLATES = [
  // ── 歡迎系列 ──
  {
    id: 'welcome_series',
    name: '歡迎系列',
    nameEn: 'Welcome Series',
    description: '新客戶加入後的歡迎郵件序列',
    trigger: 'new_customer',
    steps: [
      {
        delay_days: 0,
        delay_hours: 0,
        type: 'email',
        subject: '歡迎加入 {{company_name}}！您的專屬旅程開始了',
        content:
          '親愛的 {{customer_name}} 您好，\n\n' +
          '感謝您加入 {{company_name}} 的大家庭！我們非常高興能為您服務。\n\n' +
          '為了讓您更快速了解我們，以下是幾個實用的入門資訊：\n' +
          '• 📋 會員中心：隨時查看訂單與點數\n' +
          '• 🎁 新會員禮：輸入折扣碼 {{discount_code}} 即享首單 9 折\n' +
          '• 📞 客服專線：週一至週五 09:00-18:00\n\n' +
          '如有任何問題，歡迎隨時與我們聯繫。\n\n' +
          '祝您購物愉快！\n' +
          '{{company_name}} 團隊 敬上',
      },
      {
        delay_days: 3,
        delay_hours: 0,
        type: 'email',
        subject: '{{customer_name}}，來看看我們最受歡迎的產品吧！',
        content:
          '親愛的 {{customer_name}} 您好，\n\n' +
          '加入 {{company_name}} 已經幾天了，不知道您是否已經逛過我們的商品呢？\n\n' +
          '以下是本月最受歡迎的熱銷商品：\n' +
          '🏆 TOP 1：{{popular_product_1}}\n' +
          '🥈 TOP 2：{{popular_product_2}}\n' +
          '🥉 TOP 3：{{popular_product_3}}\n\n' +
          '每一款都經過我們團隊的嚴格挑選，品質值得信賴。\n\n' +
          '👉 點此查看完整產品目錄：{{product_catalog_url}}\n\n' +
          '{{company_name}} 團隊 敬上',
      },
      {
        delay_days: 7,
        delay_hours: 0,
        type: 'condition',
        field: 'opened_email',
        operator: 'eq',
        value: true,
        true_step: {
          type: 'email',
          subject: '{{customer_name}}，這是為您準備的專屬優惠 🎉',
          content:
            '親愛的 {{customer_name}} 您好，\n\n' +
            '感謝您持續關注 {{company_name}}！\n\n' +
            '我們為活躍會員準備了一份專屬好禮：\n' +
            '🎁 限時優惠碼：{{vip_discount_code}}\n' +
            '💰 全站商品享 85 折，優惠期限至 {{offer_expiry_date}}\n\n' +
            '趁現在把心儀商品帶回家吧！\n\n' +
            '{{company_name}} 團隊 敬上',
        },
        false_step: {
          type: 'email',
          subject: '{{customer_name}}，我們想念您！',
          content:
            '親愛的 {{customer_name}} 您好，\n\n' +
            '我們注意到您最近還沒有開啟我們的信件，不知道是不是信件跑到垃圾郵件了呢？\n\n' +
            '為了確保您不會錯過任何好康，建議您：\n' +
            '✅ 將 {{sender_email}} 加入聯絡人\n' +
            '✅ 檢查垃圾郵件匣\n\n' +
            '這裡有一份小禮物等著您：\n' +
            '🎁 回歸禮金 NT$100，輸入折扣碼 {{comeback_code}} 即可使用\n\n' +
            '期待再次見到您！\n' +
            '{{company_name}} 團隊 敬上',
        },
      },
      {
        delay_days: 14,
        delay_hours: 0,
        type: 'email',
        subject: '{{customer_name}}，會員專屬好禮已送達 🎁',
        content:
          '親愛的 {{customer_name}} 您好，\n\n' +
          '感謝您成為 {{company_name}} 會員已滿兩週！\n\n' +
          '我們為您準備了以下會員專屬福利：\n' +
          '🌟 會員點數加倍：本週購物點數 ×2\n' +
          '🌟 免運門檻降低：滿 NT$500 即免運\n' +
          '🌟 搶先預購：新品上架前 48 小時優先選購權\n\n' +
          '別忘了隨時到會員中心查看您的點數餘額與專屬優惠。\n\n' +
          '感謝您的支持！\n' +
          '{{company_name}} 團隊 敬上',
      },
    ],
  },

  // ── 購物車挽回 ──
  {
    id: 'abandoned_cart',
    name: '購物車挽回',
    nameEn: 'Abandoned Cart Recovery',
    description: '客戶放棄購物車後的挽回序列',
    trigger: 'abandoned_cart',
    steps: [
      {
        delay_days: 0,
        delay_hours: 1,
        type: 'email',
        subject: '{{customer_name}}，您的購物車還有商品等著結帳！',
        content:
          '親愛的 {{customer_name}} 您好，\n\n' +
          '您似乎忘了完成結帳，以下商品仍在您的購物車中：\n\n' +
          '🛒 {{cart_items}}\n\n' +
          '商品庫存有限，建議您盡早完成訂購以免向隅。\n\n' +
          '👉 立即結帳：{{checkout_url}}\n\n' +
          '如果您在結帳過程中遇到任何問題，歡迎聯繫我們的客服團隊，\n' +
          '我們很樂意為您協助。\n\n' +
          '{{company_name}} 團隊 敬上',
      },
      {
        delay_days: 1,
        delay_hours: 0,
        type: 'line',
        content:
          '嗨 {{customer_name}}！您的購物車還有 {{cart_item_count}} 件商品等著您 🛒\n' +
          '庫存即時更新中，熱門商品隨時可能售完！\n' +
          '👉 立即結帳：{{checkout_url}}',
      },
      {
        delay_days: 3,
        delay_hours: 0,
        type: 'email',
        subject: '{{customer_name}}，限時優惠 — 購物車商品享 9 折！',
        content:
          '親愛的 {{customer_name}} 您好，\n\n' +
          '我們知道有時候需要多考慮一下，完全理解！\n\n' +
          '為了感謝您對 {{company_name}} 的關注，我們特別為您準備了一個限時優惠：\n\n' +
          '🏷️ 折扣碼：{{discount_code}}\n' +
          '💰 購物車商品一律 9 折\n' +
          '⏰ 優惠有效期限：{{offer_expiry_date}}\n\n' +
          '您的購物車商品：\n' +
          '{{cart_items}}\n\n' +
          '👉 使用折扣碼結帳：{{checkout_url}}\n\n' +
          '{{company_name}} 團隊 敬上',
      },
      {
        delay_days: 7,
        delay_hours: 0,
        type: 'condition',
        field: 'purchased',
        operator: 'eq',
        value: false,
        true_step: null, // 已購買，停止序列
        false_step: {
          type: 'email',
          subject: '最後機會！免運費 + 專屬折扣即將到期 ⏰',
          content:
            '親愛的 {{customer_name}} 您好，\n\n' +
            '這是我們最後一次提醒您——購物車中的商品優惠即將到期！\n\n' +
            '🚚 本次加碼：免運費優惠（不限金額）\n' +
            '🏷️ 折扣碼：{{final_discount_code}}\n' +
            '⏰ 最後期限：{{final_expiry_date}}\n\n' +
            '您的購物車商品：\n' +
            '{{cart_items}}\n\n' +
            '錯過這次就要等下次活動囉！\n' +
            '👉 立即結帳：{{checkout_url}}\n\n' +
            '{{company_name}} 團隊 敬上',
        },
      },
    ],
  },

  // ── 售後關懷 ──
  {
    id: 'post_purchase',
    name: '售後關懷',
    nameEn: 'Post-Purchase Nurture',
    description: '購買後的滿意度追蹤與回購推動',
    trigger: 'post_purchase',
    steps: [
      {
        delay_days: 1,
        delay_hours: 0,
        type: 'email',
        subject: '感謝您的訂購！訂單 #{{order_number}} 確認通知',
        content:
          '親愛的 {{customer_name}} 您好，\n\n' +
          '感謝您在 {{company_name}} 購物！您的訂單已成功建立。\n\n' +
          '📦 訂單編號：#{{order_number}}\n' +
          '📋 訂購商品：{{order_items}}\n' +
          '💰 訂單金額：NT${{order_total}}\n' +
          '🚚 預計出貨日：{{estimated_shipping_date}}\n\n' +
          '您可以隨時到會員中心查看物流進度。\n' +
          '如有任何疑問，歡迎聯繫客服。\n\n' +
          '{{company_name}} 團隊 敬上',
      },
      {
        delay_days: 3,
        delay_hours: 0,
        type: 'line',
        content:
          '{{customer_name}} 您好！您的訂單 #{{order_number}} 已出貨 📦\n' +
          '物流單號：{{tracking_number}}\n' +
          '預計 {{delivery_date}} 送達，請留意收件！',
      },
      {
        delay_days: 7,
        delay_hours: 0,
        type: 'email',
        subject: '{{customer_name}}，您的商品使用得還順利嗎？',
        content:
          '親愛的 {{customer_name}} 您好，\n\n' +
          '您購買的 {{product_name}} 應該已經到手一段時間了，\n' +
          '不知道使用起來是否滿意呢？\n\n' +
          '我們非常重視您的使用體驗，若有任何問題歡迎隨時回信告訴我們。\n\n' +
          '🌟 也歡迎您花 30 秒為商品留下評價，幫助更多人做出選擇：\n' +
          '👉 留下評價：{{review_url}}\n\n' +
          '感謝您的寶貴意見！\n' +
          '{{company_name}} 團隊 敬上',
      },
      {
        delay_days: 14,
        delay_hours: 0,
        type: 'condition',
        field: 'clicked_link',
        operator: 'eq',
        value: true,
        true_step: {
          type: 'email',
          subject: '感謝您的評價！這是您的回饋禮 🎁',
          content:
            '親愛的 {{customer_name}} 您好，\n\n' +
            '非常感謝您撥空為我們留下評價！\n\n' +
            '為了感謝您的回饋，我們為您準備了一份小禮物：\n' +
            '🎁 回饋禮金 NT$50，已自動存入您的會員帳戶\n' +
            '📌 下次消費即可折抵，無最低消費限制\n\n' +
            '期待再次為您服務！\n' +
            '{{company_name}} 團隊 敬上',
        },
        false_step: {
          type: 'email',
          subject: '{{customer_name}}，填寫問卷就送 NT$50 購物金！',
          content:
            '親愛的 {{customer_name}} 您好，\n\n' +
            '我們非常在意您的購物體驗，想請您花 1 分鐘填寫簡短問卷。\n\n' +
            '🎁 完成問卷即可獲得 NT$50 購物金\n' +
            '👉 填寫問卷：{{survey_url}}\n\n' +
            '您的每一則回饋都是我們進步的動力，感謝您！\n' +
            '{{company_name}} 團隊 敬上',
        },
      },
      {
        delay_days: 30,
        delay_hours: 0,
        type: 'email',
        subject: '{{customer_name}}，猜您可能也會喜歡這些 ✨',
        content:
          '親愛的 {{customer_name}} 您好，\n\n' +
          '根據您之前購買的 {{product_name}}，我們精選了幾款您可能感興趣的商品：\n\n' +
          '✨ {{recommended_product_1}} — NT${{recommended_price_1}}\n' +
          '✨ {{recommended_product_2}} — NT${{recommended_price_2}}\n' +
          '✨ {{recommended_product_3}} — NT${{recommended_price_3}}\n\n' +
          '🏷️ 會員回購優惠：結帳輸入 {{rebuy_code}} 享 88 折\n\n' +
          '👉 查看推薦商品：{{recommendations_url}}\n\n' +
          '{{company_name}} 團隊 敬上',
      },
    ],
  },

  // ── 沉睡客戶喚醒 ──
  {
    id: 'reengagement',
    name: '沉睡客戶喚醒',
    nameEn: 'Re-engagement',
    description: '30天未活動客戶的再互動序列',
    trigger: 'inactivity',
    steps: [
      {
        delay_days: 0,
        delay_hours: 0,
        type: 'email',
        subject: '{{customer_name}}，好久不見！我們想念您 ❤️',
        content:
          '親愛的 {{customer_name}} 您好，\n\n' +
          '我們發現您已經有一段時間沒有來 {{company_name}} 逛逛了，\n' +
          '不知道一切是否安好？\n\n' +
          '在您離開的這段時間，我們有了不少新變化：\n' +
          '🆕 新品上市：{{new_product_highlight}}\n' +
          '🔥 熱銷回歸：{{bestseller_highlight}}\n' +
          '🎊 限時活動：{{current_promotion}}\n\n' +
          '歡迎隨時回來逛逛，我們一直都在！\n\n' +
          '{{company_name}} 團隊 敬上',
      },
      {
        delay_days: 5,
        delay_hours: 0,
        type: 'line',
        content:
          '{{customer_name}} 您好，{{company_name}} 想您了！🥺\n' +
          '我們準備了專屬回歸禮等您來拿 🎁\n' +
          '👉 查看詳情：{{reengagement_url}}',
      },
      {
        delay_days: 10,
        delay_hours: 0,
        type: 'email',
        subject: '專屬回歸禮：{{customer_name}} 的 VIP 優惠券',
        content:
          '親愛的 {{customer_name}} 您好，\n\n' +
          '我們為您準備了一份專屬回歸禮：\n\n' +
          '🎁 VIP 回歸優惠券\n' +
          '💰 折扣碼：{{reengagement_code}}\n' +
          '💵 全站商品享 8 折（無低消限制）\n' +
          '🚚 加碼免運費\n' +
          '⏰ 有效期限：{{offer_expiry_date}}\n\n' +
          '這是我們特別為老朋友準備的，名額有限喔！\n\n' +
          '👉 立即選購：{{shop_url}}\n\n' +
          '{{company_name}} 團隊 敬上',
      },
      {
        delay_days: 20,
        delay_hours: 0,
        type: 'condition',
        field: 'opened_email',
        operator: 'eq',
        value: true,
        true_step: {
          type: 'email',
          subject: '歡迎回來！再加碼送您 NT$200 購物金',
          content:
            '親愛的 {{customer_name}} 您好，\n\n' +
            '很高興看到您回來！🎉\n\n' +
            '為了慶祝您的回歸，我們額外贈送 NT$200 購物金至您的帳戶。\n' +
            '📌 購物金已自動儲值，下次購物時即可折抵。\n\n' +
            '歡迎隨時來選購！\n' +
            '{{company_name}} 團隊 敬上',
        },
        false_step: {
          type: 'sms',
          content:
            '【{{company_name}}】{{customer_name}} 您好，' +
            '我們為您保留了專屬優惠碼 {{reengagement_code}}（8折+免運），' +
            '期限至 {{offer_expiry_date}}，歡迎回來選購！',
        },
      },
    ],
  },

  // ── 生日 VIP 禮遇 ──
  {
    id: 'birthday_vip',
    name: '生日VIP禮遇',
    nameEn: 'Birthday VIP',
    description: '會員生日前後的專屬優惠',
    trigger: 'birthday',
    steps: [
      {
        delay_days: -7, // 生日前 7 天
        delay_hours: 0,
        type: 'email',
        subject: '🎂 {{customer_name}}，生日快樂！專屬好禮搶先送',
        content:
          '親愛的 {{customer_name}} 您好，\n\n' +
          '您的生日即將到來，{{company_name}} 全體同仁提前祝您生日快樂！🎉\n\n' +
          '我們為您準備了專屬的生日 VIP 禮遇：\n\n' +
          '🎁 生日禮金：NT${{birthday_credit}} 購物金（已存入帳戶）\n' +
          '🏷️ 生日折扣碼：{{birthday_code}}（全站 75 折）\n' +
          '🚚 生日免運：整個生日月不限金額免運費\n' +
          '🌟 生日雙倍點數：購物點數加倍累積\n\n' +
          '⏰ 優惠期限：{{birthday_month_start}} ~ {{birthday_month_end}}\n\n' +
          '用最划算的價格犒賞自己吧！\n' +
          '👉 開始選購：{{shop_url}}\n\n' +
          '{{company_name}} 團隊 敬上',
      },
      {
        delay_days: 0, // 生日當天
        delay_hours: 9, // 早上 9 點
        type: 'line',
        content:
          '🎂🎉 {{customer_name}}，生日快樂！\n\n' +
          '{{company_name}} 祝您生日快樂，天天開心！\n' +
          '您的生日禮金 NT${{birthday_credit}} 已到帳\n' +
          '整個生日月都可以使用喔 🎁',
      },
      {
        delay_days: 0, // 生日當天
        delay_hours: 0,
        type: 'email',
        subject: '🎂 生日快樂，{{customer_name}}！今天是屬於您的特別日子',
        content:
          '親愛的 {{customer_name}} 您好，\n\n' +
          '🎂 祝您生日快樂！🎂\n\n' +
          '今天是屬於您的特別日子，{{company_name}} 衷心祝福您：\n' +
          '新的一歲，一切順心如意！\n\n' +
          '提醒您，以下生日好禮仍可使用：\n' +
          '🎁 NT${{birthday_credit}} 購物金\n' +
          '🏷️ 折扣碼 {{birthday_code}}（75 折）\n' +
          '🚚 不限金額免運費\n\n' +
          '今天買什麼都開心！🎉\n' +
          '👉 選購去：{{shop_url}}\n\n' +
          '{{company_name}} 團隊 敬上',
      },
      {
        delay_days: 7, // 生日後 7 天
        delay_hours: 0,
        type: 'condition',
        field: 'purchased',
        operator: 'eq',
        value: false,
        true_step: {
          type: 'email',
          subject: '感謝您使用生日優惠！期待再次為您服務',
          content:
            '親愛的 {{customer_name}} 您好，\n\n' +
            '感謝您使用了生日優惠，希望您喜歡挑選的商品！\n\n' +
            '別忘了生日月的優惠仍然有效，歡迎繼續選購。\n' +
            '也歡迎推薦好友加入會員，一起享受更多福利！\n\n' +
            '{{company_name}} 團隊 敬上',
        },
        false_step: {
          type: 'email',
          subject: '{{customer_name}}，生日優惠即將到期，把握最後機會！',
          content:
            '親愛的 {{customer_name}} 您好，\n\n' +
            '提醒您，生日專屬優惠即將到期：\n\n' +
            '🎁 NT${{birthday_credit}} 購物金尚未使用\n' +
            '🏷️ 75 折折扣碼 {{birthday_code}} 即將到期\n' +
            '⏰ 最後期限：{{birthday_month_end}}\n\n' +
            '別讓這些好禮浪費了，趕快犒賞自己吧！\n' +
            '👉 立即選購：{{shop_url}}\n\n' +
            '{{company_name}} 團隊 敬上',
        },
      },
    ],
  },

  // ── 產品導引 ──
  {
    id: 'onboarding',
    name: '產品導引',
    nameEn: 'Product Onboarding',
    description: '新用戶產品功能引導序列',
    trigger: 'subscription',
    steps: [
      {
        delay_days: 0,
        delay_hours: 0,
        type: 'email',
        subject: '歡迎使用 {{product_name}}！快速上手指南',
        content:
          '親愛的 {{customer_name}} 您好，\n\n' +
          '恭喜您成功啟用 {{product_name}}！🎉\n\n' +
          '以下是快速上手的三個步驟：\n\n' +
          '📌 步驟一：完成基本設定\n' +
          '登入後台，填寫公司資訊與偏好設定。\n' +
          '👉 前往設定：{{settings_url}}\n\n' +
          '📌 步驟二：匯入您的資料\n' +
          '支援 Excel / CSV 一鍵匯入，快速搬遷無負擔。\n' +
          '👉 匯入工具：{{import_url}}\n\n' +
          '📌 步驟三：邀請團隊成員\n' +
          '邀請同事一起協作，發揮最大效率。\n' +
          '👉 邀請連結：{{invite_url}}\n\n' +
          '如需協助，隨時聯繫我們的專屬客服。\n\n' +
          '{{company_name}} 團隊 敬上',
      },
      {
        delay_days: 2,
        delay_hours: 0,
        type: 'email',
        subject: '{{customer_name}}，來看看 {{product_name}} 最實用的功能！',
        content:
          '親愛的 {{customer_name}} 您好，\n\n' +
          '使用 {{product_name}} 兩天了，以下是其他用戶最推薦的功能：\n\n' +
          '🔥 功能亮點 1：{{feature_highlight_1}}\n' +
          '省下 {{time_saved_1}} 的作業時間，讓您專注在重要的事。\n\n' +
          '🔥 功能亮點 2：{{feature_highlight_2}}\n' +
          '{{feature_benefit_2}}\n\n' +
          '🔥 功能亮點 3：{{feature_highlight_3}}\n' +
          '{{feature_benefit_3}}\n\n' +
          '📺 教學影片：{{tutorial_video_url}}\n' +
          '📖 使用手冊：{{docs_url}}\n\n' +
          '{{company_name}} 團隊 敬上',
      },
      {
        delay_days: 5,
        delay_hours: 0,
        type: 'line',
        content:
          '{{customer_name}} 您好！使用 {{product_name}} 還順利嗎？\n' +
          '如有任何問題，隨時在 LINE 上詢問我們 💬\n' +
          '或預約免費一對一教學：{{booking_url}}',
      },
      {
        delay_days: 7,
        delay_hours: 0,
        type: 'condition',
        field: 'visited_page',
        operator: 'eq',
        value: true,
        true_step: {
          type: 'email',
          subject: '太棒了！您已經是 {{product_name}} 進階使用者 🏆',
          content:
            '親愛的 {{customer_name}} 您好，\n\n' +
            '恭喜您！我們發現您已經熟練使用 {{product_name}} 的核心功能了。🎉\n\n' +
            '想更上一層樓嗎？以下是進階技巧：\n' +
            '🚀 進階功能 1：自動化工作流程\n' +
            '🚀 進階功能 2：自訂報表與儀表板\n' +
            '🚀 進階功能 3：API 串接整合\n\n' +
            '👉 進階教學：{{advanced_tutorial_url}}\n\n' +
            '{{company_name}} 團隊 敬上',
        },
        false_step: {
          type: 'email',
          subject: '{{customer_name}}，需要我們協助您上手嗎？',
          content:
            '親愛的 {{customer_name}} 您好，\n\n' +
            '我們注意到您可能還在摸索 {{product_name}} 的功能，\n' +
            '沒關係，我們提供以下免費資源協助您：\n\n' +
            '📞 免費一對一線上教學（30 分鐘）\n' +
            '👉 預約時段：{{booking_url}}\n\n' +
            '📺 快速入門影片（5 分鐘看完）\n' +
            '👉 觀看影片：{{quickstart_video_url}}\n\n' +
            '💬 即時客服支援\n' +
            '👉 LINE 客服：{{line_support_url}}\n\n' +
            '我們隨時在這裡幫助您！\n' +
            '{{company_name}} 團隊 敬上',
        },
      },
      {
        delay_days: 14,
        delay_hours: 0,
        type: 'email',
        subject: '{{customer_name}}，您的 {{product_name}} 使用報告出爐了 📊',
        content:
          '親愛的 {{customer_name}} 您好，\n\n' +
          '您已使用 {{product_name}} 滿兩週，以下是您的使用摘要：\n\n' +
          '📊 使用統計\n' +
          '• 登入次數：{{login_count}} 次\n' +
          '• 常用功能：{{top_feature}}\n' +
          '• 節省時間：預估約 {{time_saved_total}}\n\n' +
          '🌟 使用建議\n' +
          '根據您的使用習慣，我們建議您也試試 {{suggested_feature}}，\n' +
          '許多類似產業的用戶都覺得非常實用。\n\n' +
          '💡 有任何產品建議或功能許願嗎？歡迎回信告訴我們！\n\n' +
          '{{company_name}} 團隊 敬上',
      },
    ],
  },
]
