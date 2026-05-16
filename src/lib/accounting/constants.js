// ─── 台灣標準會計科目表 ───────────────────────────────────────

/** @type {Array<{code: string, name: string, type: string}>} */
export const CHART_OF_ACCOUNTS = [
  // 1xxx 資產
  { code: '1100', name: '現金',       type: '資產' },
  { code: '1102', name: '銀行存款',   type: '資產' },
  { code: '1130', name: '應收帳款',   type: '資產' },
  { code: '1141', name: '應收票據',   type: '資產' },
  { code: '1150', name: '存貨',       type: '資產' },
  { code: '1600', name: '固定資產',   type: '資產' },
  { code: '1610', name: '累計折舊',   type: '資產' },

  // 2xxx 負債
  { code: '2100', name: '應付帳款',   type: '負債' },
  { code: '2110', name: '應付票據',   type: '負債' },
  { code: '2200', name: '短期借款',   type: '負債' },
  { code: '2300', name: '長期借款',   type: '負債' },

  // 3xxx 權益
  { code: '3100', name: '股本',       type: '權益' },
  { code: '3200', name: '資本公積',   type: '權益' },
  { code: '3300', name: '保留盈餘',   type: '權益' },

  // 4xxx 收入
  { code: '4100', name: '營業收入',   type: '收入' },
  { code: '4200', name: '銷貨退回',   type: '收入' },

  // 5xxx 銷貨成本
  { code: '5100', name: '銷貨成本',   type: '銷貨成本' },

  // 6xxx 營業費用
  { code: '6100', name: '薪資費用',   type: '營業費用' },
  { code: '6200', name: '租金費用',   type: '營業費用' },
  { code: '6300', name: '折舊費用',   type: '營業費用' },
  { code: '6400', name: '水電費',     type: '營業費用' },
  { code: '6500', name: '保險費',     type: '營業費用' },
  { code: '6600', name: '交際費',     type: '營業費用' },
  { code: '6700', name: '文具用品',   type: '營業費用' },

  // 7xxx 營業外收入/支出
  { code: '7100', name: '利息收入',   type: '營業外收入/支出' },
  { code: '7200', name: '利息支出',   type: '營業外收入/支出' },
  { code: '7300', name: '匯兌損益',   type: '營業外收入/支出' },
]

// ─── 科目代碼 → 類型映射 ─────────────────────────────────────

/**
 * 依科目代碼取得科目類型
 * @param {string} code — 四碼科目代碼
 * @returns {string} 科目類型（資產/負債/權益/收入/銷貨成本/營業費用/營業外收入/支出）
 */
export function getAccountType(code) {
  if (!code || typeof code !== 'string') return '未知'
  const prefix = code.charAt(0)
  switch (prefix) {
    case '1': return '資產'
    case '2': return '負債'
    case '3': return '權益'
    case '4': return '收入'
    case '5': return '銷貨成本'
    case '6': return '營業費用'
    case '7': return '營業外收入/支出'
    default:  return '未知'
  }
}
