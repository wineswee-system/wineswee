// ══════════════════════════════════════
//  常數定義
// ══════════════════════════════════════

/** 倉庫區域類型 */
export const ZONE_TYPES = ['receiving', 'storage', 'picking', 'shipping', 'quarantine', 'returns']

/** 庫存調整原因 */
export const ADJUSTMENT_REASONS = [
  { code: 'DAMAGE', label: '損壞報廢', requiresApproval: true },
  { code: 'THEFT', label: '盜竊短少', requiresApproval: true },
  { code: 'COUNT_VARIANCE', label: '盤點差異', requiresApproval: false },
  { code: 'QUALITY_REJECT', label: '品質不合格', requiresApproval: true },
  { code: 'EXPIRY', label: '過期報廢', requiresApproval: false },
  { code: 'RETURN_RESTOCK', label: '退貨入庫', requiresApproval: false },
  { code: 'PRODUCTION_SCRAP', label: '生產報廢', requiresApproval: true },
  { code: 'OTHER', label: '其他', requiresApproval: true },
]

// 精確到小數點兩位的四捨五入
export const round2 = (x) => Math.round(x * 100) / 100
