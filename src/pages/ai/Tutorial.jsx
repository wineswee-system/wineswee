import { useState } from 'react'

const DIFFICULTY_STYLE = {
  '入門': 'badge-success',
  '進階': 'badge-info',
  '專業': 'badge-purple',
}

const CATEGORIES = [
  {
    key: 'quickstart',
    icon: '🚀',
    title: '快速入門',
    items: [
      { title: '首次登入與環境設定', time: '5 分鐘', difficulty: '入門' },
      { title: '使用者介面導覽', time: '5 分鐘', difficulty: '入門' },
      { title: '建立第一筆員工資料', time: '5 分鐘', difficulty: '入門' },
      { title: '第一次排班操作', time: '10 分鐘', difficulty: '入門' },
      { title: '多租戶切換與公司設定', time: '5 分鐘', difficulty: '入門' },
    ],
  },
  {
    key: 'org',
    icon: '🏢',
    title: '組織架構',
    items: [
      { title: '公司與門市建立', time: '10 分鐘', difficulty: '入門' },
      { title: '部門結構與組織圖', time: '10 分鐘', difficulty: '進階' },
      { title: '員工資料管理', time: '10 分鐘', difficulty: '入門' },
      { title: 'LINE 帳號綁定', time: '5 分鐘', difficulty: '入門' },
    ],
  },
  {
    key: 'hr',
    icon: '👥',
    title: '人事管理',
    items: [
      { title: '打卡設定與追蹤', time: '5 分鐘', difficulty: '入門' },
      { title: '未打卡員工查看與代打卡', time: '5 分鐘', difficulty: '入門' },
      { title: '請假申請與工作流程審核', time: '10 分鐘', difficulty: '進階' },
      { title: '請假駁回原因查看與重送', time: '5 分鐘', difficulty: '入門' },
      { title: '加班申請流程', time: '10 分鐘', difficulty: '進階' },
      { title: '排班管理與規則設定', time: '15 分鐘', difficulty: '進階' },
      { title: '薪資計算與勞健保設定', time: '15 分鐘', difficulty: '專業' },
      { title: '薪資結算鎖定（Finalize）操作', time: '5 分鐘', difficulty: '進階' },
      { title: '績效考核設定', time: '15 分鐘', difficulty: '進階' },
      { title: '招募管理與面試排程', time: '10 分鐘', difficulty: '進階' },
      { title: '勞檢報表產出', time: '10 分鐘', difficulty: '專業' },
    ],
  },
  {
    key: 'crm',
    icon: '🤝',
    title: 'CRM 客戶管理',
    items: [
      { title: '客戶資料建立', time: '10 分鐘', difficulty: '入門' },
      { title: '客戶 360 全方位視圖', time: '10 分鐘', difficulty: '進階' },
      { title: '客戶分群與標籤', time: '10 分鐘', difficulty: '進階' },
      { title: '銷售漏斗管理', time: '15 分鐘', difficulty: '進階' },
      { title: '會員等級與積分', time: '10 分鐘', difficulty: '進階' },
    ],
  },
  {
    key: 'marketing',
    icon: '📣',
    title: '行銷自動化',
    items: [
      { title: '行銷活動建立', time: '10 分鐘', difficulty: '進階' },
      { title: 'Drip Campaign 設定', time: '15 分鐘', difficulty: '專業' },
      { title: '表單建立器操作', time: '10 分鐘', difficulty: '進階' },
      { title: '客服工單處理', time: '10 分鐘', difficulty: '進階' },
    ],
  },
  {
    key: 'sales',
    icon: '💰',
    title: '銷售管理',
    items: [
      { title: '報價單建立與轉訂單', time: '10 分鐘', difficulty: '進階' },
      { title: '銷售訂單處理', time: '10 分鐘', difficulty: '進階' },
      { title: '一鍵建立出貨並自動標記已出貨', time: '5 分鐘', difficulty: '入門' },
      { title: '促銷活動與價格規則', time: '15 分鐘', difficulty: '進階' },
      { title: '退貨與退款流程', time: '10 分鐘', difficulty: '進階' },
      { title: '物流追蹤操作', time: '10 分鐘', difficulty: '進階' },
    ],
  },
  {
    key: 'pos',
    icon: '🖥️',
    title: 'POS 收銀',
    items: [
      { title: '收銀台基本操作', time: '5 分鐘', difficulty: '入門' },
      { title: '多元支付與結帳', time: '10 分鐘', difficulty: '進階' },
      { title: '交班日結與對帳', time: '10 分鐘', difficulty: '進階' },
    ],
  },
  {
    key: 'purchase',
    icon: '🛒',
    title: '採購管理',
    items: [
      { title: '供應商建檔與管理', time: '10 分鐘', difficulty: '入門' },
      { title: '採購申請與核准', time: '10 分鐘', difficulty: '進階' },
      { title: '採購單建立與追蹤', time: '15 分鐘', difficulty: '進階' },
      { title: '進貨驗收作業', time: '10 分鐘', difficulty: '進階' },
      { title: '三方比對操作', time: '15 分鐘', difficulty: '專業' },
      { title: '供應商績效評估', time: '10 分鐘', difficulty: '專業' },
    ],
  },
  {
    key: 'warehouse',
    icon: '📦',
    title: '倉儲管理',
    items: [
      { title: '商品主檔與 SKU 建立', time: '10 分鐘', difficulty: '入門' },
      { title: '儲位規劃與管理', time: '10 分鐘', difficulty: '進階' },
      { title: '進出貨作業流程', time: '15 分鐘', difficulty: '進階' },
      { title: '揀貨/包裝/出貨', time: '15 分鐘', difficulty: '進階' },
      { title: '批號追蹤與效期管理', time: '10 分鐘', difficulty: '專業' },
      { title: '盤點作業與庫存調整', time: '15 分鐘', difficulty: '專業' },
      { title: '庫存估價方法設定', time: '10 分鐘', difficulty: '專業' },
    ],
  },
  {
    key: 'manufacturing',
    icon: '🏭',
    title: '製造管理',
    items: [
      { title: 'BOM 物料清單建立', time: '15 分鐘', difficulty: '進階' },
      { title: 'MRP 需求計畫運算', time: '15 分鐘', difficulty: '專業' },
      { title: '製令建立與追蹤', time: '10 分鐘', difficulty: '進階' },
      { title: '生產排程與派工', time: '15 分鐘', difficulty: '專業' },
      { title: '現場報工操作', time: '10 分鐘', difficulty: '進階' },
      { title: '品質管理與檢驗', time: '10 分鐘', difficulty: '專業' },
    ],
  },
  {
    key: 'finance',
    icon: '💳',
    title: '財務會計',
    items: [
      { title: '傳票建立與過帳', time: '15 分鐘', difficulty: '專業' },
      { title: '應收應付帳款管理', time: '15 分鐘', difficulty: '進階' },
      { title: '電子發票操作', time: '10 分鐘', difficulty: '進階' },
      { title: '銀行對帳操作', time: '15 分鐘', difficulty: '專業' },
      { title: '財務報表產出', time: '10 分鐘', difficulty: '進階' },
      { title: '預算管理設定', time: '15 分鐘', difficulty: '專業' },
      { title: '固定資產管理', time: '10 分鐘', difficulty: '專業' },
      { title: '期間關帳作業', time: '10 分鐘', difficulty: '專業' },
    ],
  },
  {
    key: 'tax',
    icon: '🧾',
    title: '稅務申報',
    items: [
      { title: '401 營業稅申報', time: '15 分鐘', difficulty: '專業' },
      { title: '稅務報表核對', time: '10 分鐘', difficulty: '專業' },
      { title: '電子發票 MIG/Turnkey', time: '15 分鐘', difficulty: '專業' },
    ],
  },
  {
    key: 'process',
    icon: '🔄',
    title: '流程管理',
    items: [
      { title: '自訂流程建立', time: '10 分鐘', difficulty: '進階' },
      { title: 'AI 語音輸入建立工作流程', time: '10 分鐘', difficulty: '進階' },
      { title: 'AI 逐步確認生成步驟與優先級', time: '10 分鐘', difficulty: '進階' },
      { title: '工作流程封存（Archive）作業', time: '5 分鐘', difficulty: '進階' },
      { title: '費用申請簽核鏈設定', time: '15 分鐘', difficulty: '進階' },
      { title: '金額區間與審核人規則設定', time: '10 分鐘', difficulty: '進階' },
      { title: '簽核路徑視覺化預覽', time: '5 分鐘', difficulty: '入門' },
      { title: '多層簽核自動推進與駁回', time: '10 分鐘', difficulty: '進階' },
      { title: '任務指派與追蹤', time: '10 分鐘', difficulty: '進階' },
      { title: '查核清單設定', time: '10 分鐘', difficulty: '進階' },
      { title: 'SOP 範本管理', time: '10 分鐘', difficulty: '進階' },
    ],
  },
  {
    key: 'analytics',
    icon: '📊',
    title: '數據分析',
    items: [
      { title: 'BI 營運看板使用', time: '10 分鐘', difficulty: '進階' },
      { title: '銷售預測功能', time: '15 分鐘', difficulty: '專業' },
      { title: '異常偵測設定', time: '10 分鐘', difficulty: '專業' },
      { title: '自訂儀表板建立', time: '15 分鐘', difficulty: '進階' },
      { title: '排程報表與自動寄送', time: '10 分鐘', difficulty: '進階' },
    ],
  },
  {
    key: 'ai',
    icon: '🤖',
    title: 'AI 功能',
    items: [
      { title: 'Agent 控制台操作', time: '10 分鐘', difficulty: '進階' },
      { title: 'AI 助理對話與指令', time: '10 分鐘', difficulty: '入門' },
      { title: 'AI 語音輸入（中文）操作實作', time: '10 分鐘', difficulty: '進階' },
      { title: 'AI 逐步確認生成工作流程', time: '10 分鐘', difficulty: '進階' },
      { title: 'AI 行銷文案生成（Email/LINE/SMS）', time: '10 分鐘', difficulty: '進階' },
      { title: 'AI 智慧客服回覆草稿', time: '10 分鐘', difficulty: '進階' },
      { title: 'AI 增強線索評分', time: '10 分鐘', difficulty: '進階' },
      { title: '自然語言轉分群規則', time: '15 分鐘', difficulty: '專業' },
      { title: '智能報表生成', time: '15 分鐘', difficulty: '進階' },
      { title: 'AI 排程與異常偵測', time: '10 分鐘', difficulty: '專業' },
    ],
  },
  {
    key: 'integration',
    icon: '🔗',
    title: '整合與串接',
    items: [
      { title: 'LINE 整合（Wineswe 員工機器人）設定', time: '10 分鐘', difficulty: '進階' },
      { title: 'LINE 帳號綁定與 OA 推播', time: '10 分鐘', difficulty: '進階' },
      { title: 'DB 觸發器自動推播說明', time: '10 分鐘', difficulty: '專業' },
      { title: '電商平台串接', time: '15 分鐘', difficulty: '專業' },
      { title: 'API 整合說明', time: '15 分鐘', difficulty: '專業' },
      { title: '物流商串接設定', time: '10 分鐘', difficulty: '專業' },
    ],
  },
  {
    key: 'system',
    icon: '⚙️',
    title: '系統管理',
    items: [
      { title: '使用者與權限設定', time: '10 分鐘', difficulty: '進階' },
      { title: '租戶管理', time: '10 分鐘', difficulty: '專業' },
      { title: '觸發器與自動化', time: '15 分鐘', difficulty: '進階' },
      { title: '稽核紀錄查詢', time: '10 分鐘', difficulty: '進階' },
      { title: '資料匯入匯出', time: '10 分鐘', difficulty: '入門' },
    ],
  },
]

export default function Tutorial() {
  const [expanded, setExpanded] = useState(
    Object.fromEntries(CATEGORIES.map(c => [c.key, true]))
  )

  const toggle = (key) => {
    setExpanded(prev => ({ ...prev, [key]: !prev[key] }))
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">📚</span> 教學中心</h2>
            <p>從入門到進階，快速掌握系統操作</p>
          </div>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 24 }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-blue)', '--card-accent-dim': 'var(--accent-blue-dim)' }}>
          <div className="stat-card-label">教學分類</div>
          <div className="stat-card-value">{CATEGORIES.length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">教學項目</div>
          <div className="stat-card-value">{CATEGORIES.reduce((sum, c) => sum + c.items.length, 0)}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-label">預估總時長</div>
          <div className="stat-card-value">{CATEGORIES.reduce((sum, c) => sum + c.items.reduce((s, i) => s + parseInt(i.time), 0), 0)} 分</div>
        </div>
      </div>

      {CATEGORIES.map(cat => (
        <div key={cat.key} className="card" style={{ marginBottom: 16 }}>
          <div
            className="card-header"
            style={{ cursor: 'pointer', userSelect: 'none' }}
            onClick={() => toggle(cat.key)}
          >
            <div className="card-title">
              <span className="card-title-icon">{cat.icon}</span> {cat.title}
              <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 400, marginLeft: 8 }}>
                ({cat.items.length} 篇)
              </span>
            </div>
            <span style={{ fontSize: 18, color: 'var(--text-muted)', transition: 'transform 0.2s', transform: expanded[cat.key] ? 'rotate(0deg)' : 'rotate(-90deg)' }}>
              ▼
            </span>
          </div>
          {expanded[cat.key] && (
            <div style={{ padding: '4px 20px 16px' }}>
              {cat.items.map((item, i) => (
                <div key={i} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 0',
                  borderBottom: i < cat.items.length - 1 ? '1px solid var(--border-color)' : 'none',
                }}>
                  <div style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    background: 'var(--bg-secondary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 14,
                    fontWeight: 600,
                    color: 'var(--text-muted)',
                    border: '1px solid var(--border-color)',
                    flexShrink: 0,
                  }}>{i + 1}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>{item.title}</div>
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>⏱ {item.time}</span>
                  <span className={`badge ${DIFFICULTY_STYLE[item.difficulty] || 'badge-info'}`}>
                    <span className="badge-dot"></span>{item.difficulty}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
