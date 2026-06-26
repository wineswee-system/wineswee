// DB status 顯示層轉換：核銷狀態統一改顯示為「驗收」字眼
// DB enum 字串不改（'已核銷' / '待核銷' 等），只在顯示層做映射

const SETTLE_STATUS_MAP = {
  '未送核銷': '未送驗收',
  '待核銷':   '待驗收',
  '已核銷':   '已驗收',
  '核銷已退回': '驗收退回',
}

export function displaySettleStatus(status) {
  return SETTLE_STATUS_MAP[status] ?? status
}

export function withSettleSuffix(text) {
  if (!text) return text
  return text.replace(/核銷\(驗收\)/g, '驗收').replace(/核銷/g, '驗收')
}
