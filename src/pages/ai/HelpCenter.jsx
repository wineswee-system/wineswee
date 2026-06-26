import { useState, useMemo } from 'react'
import { Search, ChevronRight, ChevronDown } from 'lucide-react'

const helpCategories = [
  {
    icon: '🏠', title: '快速入門', articles: [
      { title: '系統首次登入與密碼設定', views: 230 },
      { title: '使用者介面導覽', views: 198 },
      { title: '個人設定與偏好調整', views: 145 },
      { title: '多租戶切換說明', views: 102 },
    ]
  },
  {
    icon: '🤝', title: 'CRM 客戶管理', articles: [
      { title: '客戶資料建立與管理', views: 178 },
      { title: '客戶 360 視圖與互動時間軸', views: 215 },
      { title: '客戶分群與智慧標籤', views: 168 },
      { title: '銷售漏斗與機會管理', views: 145 },
      { title: '會員等級與積分制度', views: 98 },
      { title: '線索管理與 Kanban 看板', views: 187 },
      { title: '線索轉換為客戶/商機', views: 142 },
      { title: '活動排程與行事曆', views: 163 },
      { title: '客戶互動快速紀錄', views: 134 },
      { title: '備註管理與釘選功能', views: 112 },
      { title: '附件上傳與檔案管理', views: 95 },
      { title: '客戶健康分數與流失預警', views: 176 },
    ]
  },
  {
    icon: '📣', title: '行銷管理', articles: [
      { title: '行銷自動化流程設定', views: 112 },
      { title: 'Drip Campaign 養成活動', views: 95 },
      { title: '表單建立器使用教學', views: 128 },
      { title: '發送紀錄與成效追蹤（多管道）', views: 105 },
      { title: '客服工單處理與 SLA 管理', views: 143 },
      { title: 'AI 行銷文案自動生成', views: 198 },
      { title: 'AI 智慧客服回覆建議', views: 167 },
      { title: '工作流程自動化執行引擎', views: 132 },
    ]
  },
  {
    icon: '💰', title: '銷售管理', articles: [
      { title: '報價單建立與審核', views: 167 },
      { title: '銷售訂單處理流程', views: 154 },
      { title: '促銷活動與價格規則', views: 132 },
      { title: '業務佣金計算說明', views: 98 },
      { title: '退貨與退款流程', views: 87 },
      { title: '一鍵建立出貨並自動標記已出貨', views: 142 },
      { title: '物流追蹤與出貨管理', views: 79 },
    ]
  },
  {
    icon: '🖥️', title: 'POS 收銀', articles: [
      { title: '收銀台操作指南', views: 201 },
      { title: '交班日結與對帳', views: 176 },
      { title: 'POS 營運報表說明', views: 124 },
      { title: '多元支付方式設定', views: 108 },
    ]
  },
  {
    icon: '🛒', title: '採購管理', articles: [
      { title: '供應商建檔與分類', views: 143 },
      { title: '採購申請與核准流程', views: 138 },
      { title: '採購單建立與追蹤', views: 125 },
      { title: '進貨驗收作業', views: 112 },
      { title: '合約與長期採購協議', views: 89 },
      { title: '三方比對（PO/GR/Invoice）', views: 76 },
      { title: '供應商績效評估', views: 68 },
    ]
  },
  {
    icon: '📦', title: 'WMS 倉儲管理', articles: [
      { title: '商品主檔與 SKU 管理', views: 165 },
      { title: '儲位管理與規劃', views: 132 },
      { title: '進貨入庫流程', views: 128 },
      { title: '庫存查詢與調整', views: 119 },
      { title: '揀貨/包裝/出貨作業', views: 105 },
      { title: '倉庫調撥與移轉', views: 92 },
      { title: '批號追蹤與效期管理', views: 85 },
      { title: '盤點作業說明', views: 78 },
      { title: '庫存估價方法（FIFO/加權平均）', views: 64 },
      { title: '退貨管理（RMA）流程', views: 156 },
      { title: '退貨品檢與重新入庫/報廢', views: 132 },
      { title: '組合商品（Kitting）管理', views: 143 },
      { title: '效期預警與即期品管理', views: 118 },
      { title: '庫存周轉率分析', views: 105 },
      { title: '呆滯庫存分析與處理', views: 98 },
      { title: '需求預測與安全庫存計算', views: 134 },
      { title: '自動補貨觸發說明', views: 112 },
    ]
  },
  {
    icon: '🏭', title: '製造管理', articles: [
      { title: 'BOM 物料清單建立', views: 142 },
      { title: 'MRP 需求計畫執行', views: 128 },
      { title: '製令管理與追蹤', views: 115 },
      { title: '生產排程與工單派發', views: 104 },
      { title: '生產現場報工', views: 96 },
      { title: '品質管理與檢驗', views: 82 },
      { title: '託外加工流程', views: 67 },
    ]
  },
  {
    icon: '💳', title: '財務會計', articles: [
      { title: '傳票建立與過帳', views: 189 },
      { title: '應收帳款管理', views: 167 },
      { title: '應付帳款管理', views: 158 },
      { title: '電子發票開立與作廢', views: 145 },
      { title: '銀行對帳操作說明', views: 132 },
      { title: '試算表與財務報表', views: 121 },
      { title: '損益表與現金流量表', views: 108 },
      { title: '費用申請與驗收流程', views: 178 },
      { title: '費用驗收簽核鏈設定', views: 165 },
      { title: '費用申請駁回與重新送審', views: 143 },
      { title: '預算管理與成本中心', views: 95 },
      { title: '固定資產管理', views: 82 },
      { title: '匯率管理與多幣別操作', views: 74 },
      { title: '期間關帳作業', views: 65 },
    ]
  },
  {
    icon: '🧾', title: '稅務申報', articles: [
      { title: '401 營業稅申報說明', views: 176 },
      { title: '營業稅申報流程', views: 152 },
      { title: '稅務報表產出與核對', views: 134 },
      { title: '電子發票 MIG/Turnkey 格式', views: 98 },
    ]
  },
  {
    icon: '🏢', title: '組織架構', articles: [
      { title: '公司與門市設定', views: 156 },
      { title: '部門與組織圖管理', views: 142 },
      { title: '員工資料建檔', views: 138 },
      { title: 'LINE 綁定與整合', views: 125 },
      { title: '模單範本設定', views: 89 },
      { title: '即時員工人數統計說明', views: 108 },
    ]
  },
  {
    icon: '👥', title: '人資管理', articles: [
      { title: '打卡設定與追蹤', views: 198 },
      { title: '未打卡員工即時查看', views: 176 },
      { title: '管理者一鍵代打卡', views: 154 },
      { title: '請假申請與審核流程', views: 178 },
      { title: '請假工作流程整合（多層簽核）', views: 167 },
      { title: '駁回原因內嵌顯示', views: 134 },
      { title: '加班申請說明', views: 145 },
      { title: '排班管理與規則設定', views: 132 },
      { title: '薪資計算與勞健保', views: 126 },
      { title: '薪資結算鎖定（Finalize）說明', views: 112 },
      { title: '績效考核流程', views: 108 },
      { title: '績效獎金計算', views: 95 },
      { title: '招募管理使用說明', views: 87 },
      { title: '教育訓練紀錄', views: 74 },
      { title: '勞檢報表產出', views: 62 },
    ]
  },
  {
    icon: '🔄', title: '流程管理', articles: [
      { title: '如何建立自訂流程', views: 145 },
      { title: 'AI 助理語音建立工作流程', views: 223 },
      { title: 'AI 逐步確認生成流程步驟', views: 198 },
      { title: '步驟優先級（高/中/低）設定', views: 167 },
      { title: '工作流程封存（Archive）作業', views: 143 },
      { title: '費用申請簽核鏈設定', views: 186 },
      { title: '費用申請金額區間與審核人設定', views: 172 },
      { title: '簽核路徑視覺化預覽', views: 158 },
      { title: '多層簽核自動推進說明', views: 145 },
      { title: '任務指派與追蹤', views: 128 },
      { title: '查核清單使用教學', views: 112 },
      { title: 'SOP 範本管理', views: 96 },
      { title: '簽核規則設定', views: 84 },
    ]
  },
  {
    icon: '📊', title: '數據分析', articles: [
      { title: 'BI 營運看板使用指南', views: 167 },
      { title: '銷售預測功能說明', views: 145 },
      { title: '異常偵測與告警', views: 132 },
      { title: '自訂儀表板建立', views: 118 },
      { title: '跨系統分析操作', views: 105 },
      { title: '排程報表與自動寄送', views: 92 },
      { title: '嵌入式圖表分享', views: 78 },
      { title: '需求預測演算法（SMA/WMA/季節性）', views: 124 },
      { title: '營收預測與加權管線分析', views: 112 },
    ]
  },
  {
    icon: '⚡', title: '自動化與整合', articles: [
      { title: '觸發器設定教學', views: 134 },
      { title: 'LINE 通知整合（Wineswe 員工機器人）', views: 198 },
      { title: 'LINE 帳號綁定與 OA 設定', views: 176 },
      { title: 'DB 觸發器自動推播說明', views: 145 },
      { title: '排程任務設定', views: 98 },
      { title: '簽核規則與通知', views: 87 },
      { title: '電商平台串接', views: 76 },
      { title: 'API 文件與整合說明', views: 65 },
      { title: '物流商串接設定', views: 58 },
    ]
  },
  {
    icon: '🤖', title: 'AI 功能', articles: [
      { title: 'Agent 控制台使用指南', views: 178 },
      { title: 'AI 助理功能介紹', views: 156 },
      { title: 'AI 語音輸入建立工作流程（中文）', views: 234 },
      { title: 'AI 逐步確認生成工作流程步驟', views: 212 },
      { title: '步驟優先級與角色指派設定', views: 187 },
      { title: '智能報表生成', views: 132 },
      { title: 'AI 排程建議', views: 98 },
      { title: '智能異常偵測', views: 87 },
      { title: 'AI 行銷文案生成（Email/LINE/SMS）', views: 212 },
      { title: 'AI 智慧客服回覆草稿', views: 187 },
      { title: 'AI 增強線索評分', views: 165 },
      { title: '自然語言轉客戶分群規則', views: 143 },
    ]
  },
  {
    icon: '⚙️', title: '系統管理', articles: [
      { title: '使用者與權限管理', views: 198 },
      { title: '租戶管理說明', views: 156 },
      { title: '稽核紀錄查詢', views: 132 },
      { title: '資料匯入匯出', views: 118 },
      { title: '系統效能監控', views: 95 },
      { title: '資料庫管理', views: 78 },
    ]
  },
]

const FAQ_ITEMS = [
  { q: '忘記密碼怎麼辦？', a: '請在登入頁面點選「忘記密碼」，系統將寄送重設連結至您的註冊信箱。' },
  { q: '如何切換多家公司/租戶？', a: '點選右上角的公司名稱，即可在已授權的租戶之間切換。' },
  { q: '如何匯出報表為 PDF？', a: '在各報表頁面右上方點選「匯出」按鈕，選擇 PDF 格式即可下載。' },
  { q: '員工如何用 LINE 打卡？', a: '請先至「組織架構 > LINE」完成帳號綁定，綁定後即可透過 LINE 官方帳號（Wineswe 員工機器人）進行打卡。' },
  { q: '電子發票開立失敗如何處理？', a: '請確認統一編號與買受人資料正確，並檢查 Turnkey/MIG 連線狀態。如持續失敗請至稽核紀錄查看錯誤訊息。' },
  { q: '如何設定費用申請的簽核鏈？', a: '前往「財務 > 費用驗收簽核設定」，可依申請金額區間設定不同審核人與多層步驟。啟用/停用規則無需刪除。' },
  { q: '費用申請送出後如何追蹤進度？', a: '在「費用驗收」列表中可看到目前所在簽核步驟，被駁回時會顯示駁回原因，可直接修改後重新送審。' },
  { q: '如何用 AI 建立工作流程？', a: '在「流程管理 > 工作流程」點選「AI 助理」，可用語音或文字描述需求，AI 會逐步產出每個步驟供確認，可調整角色、優先級後再儲存。' },
  { q: '主管如何幫員工補打卡？', a: '在「人資 > 打卡追蹤」可看到「未打卡」員工清單，點選員工名稱後即可代為補登今日打卡紀錄。' },
  { q: '薪資結算後還能修改嗎？', a: '薪資結算執行「Finalize（結算鎖定）」後即鎖定，無法重新計算。需聯絡系統管理員解鎖後才可重算。' },
  { q: 'LINE 通知沒有收到怎麼辦？', a: '請確認員工已在「組織架構 > LINE」完成帳號綁定，且使用的是 Wineswe 員工機器人官方帳號。通知由資料庫觸發器直接推送，無需手動操作。' },
  { q: '如何設定簽核流程？', a: '前往「系統管理 > 簽核規則」，可依模組、金額、部門等條件設定多層簽核鏈。' },
]

export default function HelpCenter() {
  const [search, setSearch] = useState('')
  const [expandedFaq, setExpandedFaq] = useState(null)

  const filteredCategories = useMemo(() => {
    if (!search.trim()) return helpCategories
    const kw = search.trim().toLowerCase()
    return helpCategories
      .map(cat => ({
        ...cat,
        articles: cat.articles.filter(a => a.title.toLowerCase().includes(kw) || cat.title.toLowerCase().includes(kw)),
      }))
      .filter(cat => cat.articles.length > 0)
  }, [search])

  const totalArticles = helpCategories.reduce((sum, c) => sum + c.articles.length, 0)

  return (
    <div className="fade-in">
      <div className="page-header">
        <h2><span className="header-icon">📚</span> 說明中心</h2>
        <p>系統使用教學與常見問題 — 共 {helpCategories.length} 大分類、{totalArticles} 篇文章</p>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-body">
          <div className="search-bar" style={{ maxWidth: 480, margin: '0 auto' }}>
            <Search className="search-icon" style={{ width: 18, height: 18 }} />
            <input
              type="text"
              placeholder="搜尋說明文章..."
              className="form-input"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ paddingLeft: 42, paddingTop: 10, paddingBottom: 10, fontSize: 14 }}
            />
          </div>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-blue)', '--card-accent-dim': 'var(--accent-blue-dim)' }}>
          <div style={{ fontSize: 24, marginBottom: 8 }}>📂</div>
          <div className="stat-card-label">文章分類</div>
          <div className="stat-card-value">{helpCategories.length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div style={{ fontSize: 24, marginBottom: 8 }}>📄</div>
          <div className="stat-card-label">說明文章</div>
          <div className="stat-card-value">{totalArticles}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div style={{ fontSize: 24, marginBottom: 8 }}>❓</div>
          <div className="stat-card-label">常見問題</div>
          <div className="stat-card-value">{FAQ_ITEMS.length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div style={{ fontSize: 24, marginBottom: 8 }}>🔧</div>
          <div className="stat-card-label">涵蓋模組</div>
          <div className="stat-card-value">12+</div>
        </div>
      </div>

      {search.trim() && filteredCategories.length === 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-body" style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
            找不到符合「{search}」的文章，請嘗試其他關鍵字
          </div>
        </div>
      )}

      <div className="grid-2">
        {filteredCategories.map((cat, i) => (
          <div key={i} className="card">
            <div className="card-header">
              <div className="card-title">
                <span style={{ marginRight: 6 }}>{cat.icon}</span>{cat.title}
                <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 400, marginLeft: 8 }}>
                  {cat.articles.length} 篇
                </span>
              </div>
            </div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {cat.articles.map((article, j) => (
                <div key={j} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
                  transition: 'background var(--transition-fast)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <ChevronRight size={14} style={{ color: 'var(--accent-cyan)' }} />
                    <span style={{ fontSize: 13 }}>{article.title}</span>
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{article.views} 次</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-header">
          <div className="card-title">❓ 常見問題 FAQ</div>
        </div>
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {FAQ_ITEMS.map((faq, i) => (
            <div key={i} style={{ borderBottom: i < FAQ_ITEMS.length - 1 ? '1px solid var(--border-color)' : 'none' }}>
              <div
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px 8px', cursor: 'pointer', userSelect: 'none',
                }}
                onClick={() => setExpandedFaq(expandedFaq === i ? null : i)}
              >
                <span style={{ fontSize: 14, fontWeight: 600 }}>{faq.q}</span>
                <ChevronDown size={16} style={{
                  color: 'var(--text-muted)',
                  transition: 'transform 0.2s',
                  transform: expandedFaq === i ? 'rotate(180deg)' : 'rotate(0deg)',
                }} />
              </div>
              {expandedFaq === i && (
                <div style={{ padding: '0 8px 12px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  {faq.a}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
