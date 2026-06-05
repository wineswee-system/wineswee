// 核銷 → 核銷(驗收) 統一顯示 helper
// DB enum status 字串不改（'已核銷' / '待核銷' 等），只在顯示層加 (驗收) 後綴

const SETTLE_STATUSES = ['未送核銷', '待核銷', '已核銷', '核銷已退回']

export function displaySettleStatus(status) {
  if (SETTLE_STATUSES.includes(status)) return `${status}(驗收)`
  return status
}

// 把任意字串裡的「核銷」加上 (驗收) 後綴
// 若已含「核銷(驗收)」「(驗收)」「驗收」則跳過避免重複
export function withSettleSuffix(text) {
  if (!text) return text
  if (text.includes('核銷(驗收)')) return text
  return text.replace(/核銷(?!\(驗收\))/g, '核銷(驗收)')
}
