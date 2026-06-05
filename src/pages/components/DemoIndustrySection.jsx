import {
  Warehouse, ShoppingCart, Factory, HeadphonesIcon, Globe, BarChart3, Check,
} from 'lucide-react'

const INDUSTRIES = [
  {
    icon: Warehouse, title: '餐飲連鎖', color: '#f97316',
    pains: ['門市多、排班複雜，人力調度困難', '食材效期管控不易，過期報廢成本高', '各店營收數據分散，老闆看不到全貌'],
    solutions: ['智慧排班 + 勞基法即時檢核', '批號效期追蹤 + 低庫存自動預警', 'POS 日結 + BI 看板即時匯總'],
  },
  {
    icon: ShoppingCart, title: '批發零售', color: '#2563eb',
    pains: ['進銷存各做各的，月底對帳對到崩潰', '客戶帳款追不回來，應收越積越多', '促銷活動人工算折扣，錯誤率高'],
    solutions: ['進貨→庫存→出貨→帳款全自動串接', '帳齡分析 + 逾期自動提醒', '促銷引擎自動套用最優方案'],
  },
  {
    icon: Factory, title: '製造業', color: '#059669',
    pains: ['物料需求靠 Excel 算，經常缺料停工', '品質問題追溯困難，不知道哪批出問題', '生產成本算不清楚，毛利只是猜的'],
    solutions: ['MRP 需求計畫自動計算缺料', '批號追蹤 + 品質檢驗紀錄完整', '進貨成本 + 工時自動算出實際毛利'],
  },
  {
    icon: HeadphonesIcon, title: '服務業', color: '#7c3aed',
    pains: ['客戶資料散在業務手機裡，離職就帶走', '專案進度追蹤靠問人，沒有系統化管理', '員工報帳流程冗長，紙本簽核效率低'],
    solutions: ['CRM 客戶 360° 集中管理', '任務流程 + SOP 範本 + 即時追蹤', 'LINE 行動簽核 + 費用線上核銷(驗收)'],
  },
  {
    icon: Globe, title: '貿易物流', color: '#d97706',
    pains: ['多幣別交易，匯率換算容易出錯', '供應商多、採購流程缺乏標準化', '倉庫跨區調撥，庫存數字不即時'],
    solutions: ['匯率管理 + 多幣別自動換算', '採購流程 + 三方比對 + 合約管理', '多倉庫即時庫存 + 調撥自動扣帳'],
  },
  {
    icon: BarChart3, title: '科技 / 新創', color: '#db2777',
    pains: ['公司快速成長，HR 流程跟不上', '業務獎金計算規則複雜，每月手算', '老闆想看數據但報表散落各處'],
    solutions: ['完整 HR 生命週期管理', 'CRM 成交數據直接連動獎金計算', 'BI 營運看板 + 自訂儀表板'],
  },
]

export default function DemoIndustrySection() {
  return (
    <div className="demo-industry-grid">
      {INDUSTRIES.map((ind, i) => {
        const IIcon = ind.icon
        return (
          <div key={i} className="demo-industry-card-v2">
            <div className="demo-ind-header">
              <div className="demo-ind-icon" style={{ '--ind-color': ind.color }}>
                <IIcon size={20} strokeWidth={1.8} />
              </div>
              <h3>{ind.title}</h3>
            </div>
            <div className="demo-ind-section">
              <div className="demo-ind-label pain">常見痛點</div>
              {ind.pains.map((p, pi) => (
                <div key={pi} className="demo-ind-item pain">{p}</div>
              ))}
            </div>
            <div className="demo-ind-section">
              <div className="demo-ind-label solution">對應方案</div>
              {ind.solutions.map((s, si) => (
                <div key={si} className="demo-ind-item solution"><Check size={12} /> {s}</div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
