import { Check } from 'lucide-react'

const COMPARISONS = [
  { feature: '導入時程', them: '半年 ~ 一年', us: '兩週內上線' },
  { feature: '授權方式', them: '按人頭計費', us: '不限使用人數' },
  { feature: '操作介面', them: '類似 Excel 表格', us: '現代化 Web UI' },
  { feature: 'LINE 整合', them: '無 / 需額外開發', us: '原生內建' },
  { feature: '模組擴充', them: '每個模組另外購買', us: '全模組包含' },
  { feature: '行動辦公', them: '需另購 App', us: 'LINE + Web 即用' },
  { feature: '跨模組串接', them: '手動匯出匯入', us: '即時自動串接' },
  { feature: '法規合規', them: '需自行檢查', us: '內建 50+ 條法規檢核' },
]

export default function DemoComparisonTable() {
  return (
    <div className="compare-table">
      <div className="compare-header">
        <div className="compare-col feature">比較項目</div>
        <div className="compare-col them">傳統 ERP</div>
        <div className="compare-col us">SME OPS</div>
      </div>
      {COMPARISONS.map((row, i) => (
        <div key={i} className="compare-row">
          <div className="compare-col feature">{row.feature}</div>
          <div className="compare-col them">{row.them}</div>
          <div className="compare-col us"><Check size={13} /> {row.us}</div>
        </div>
      ))}
    </div>
  )
}
