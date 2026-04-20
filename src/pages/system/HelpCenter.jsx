import { useState } from 'react'
import { ChevronDown, ChevronRight, Search } from 'lucide-react'

const HELP_SECTIONS = [
  {
    title: '流程管理',
    icon: '🔄',
    articles: [
      { q: '如何建立新的流程範本？', a: '進入「流程管理」→「流程範本」tab → 點擊「新增流程範本」，填寫名稱、分類，然後新增各步驟。也可以使用 AI 助手自動生成。' },
      { q: '如何部署流程到門市？', a: '在「流程範本」tab 找到要部署的範本 → 點擊「部署」→ 選擇門市 → 指派各步驟負責人 → 確認部署。' },
      { q: '如何使用 AI 助手建立流程？', a: '進入「流程管理」→「AI 助手」tab → 輸入你需要的流程描述（例如「我需要一個新員工入職流程」）→ AI 會自動生成步驟 → 點擊「儲存到流程範本」。' },
      { q: '什麼是前置條件和觸發動作？', a: '前置條件：該任務必須等所有前置任務完成才能開始。觸發動作：該任務完成時會自動啟動指定的下一個任務。在任務詳情中設定。' },
    ],
  },
  {
    title: '任務管理',
    icon: '📋',
    articles: [
      { q: '如何查看我的任務？', a: '進入「任務」頁面可看到所有任務。用 tab 篩選待辦/進行中/已完成，也可用搜尋和門市/負責人篩選。' },
      { q: '如何在任務中關聯清單？', a: '點擊任務 → 在彈窗中找到「清單設定」→ 從下拉選擇已建立的查核清單。清單項目可在任務中直接勾選。' },
      { q: '任務的簽核流程怎麼用？', a: '在任務詳情最底部「簽核流程」→ 選擇簽核鏈 → 系統自動建立多關卡審批。每關可核准或退回。' },
    ],
  },
  {
    title: '查核清單',
    icon: '☑️',
    articles: [
      { q: '如何建立查核清單？', a: '進入「查核清單」→ 點擊「新增清單」→ 輸入名稱 → 展開後新增各項目。項目可隨時編輯或刪除。' },
      { q: '清單和任務的關係？', a: '清單在「查核清單」頁面建立和管理（定義項目），在「任務詳情」中關聯到特定任務。實際勾選在任務中或 LIFF 端操作。' },
    ],
  },
  {
    title: '出勤管理',
    icon: '⏰',
    articles: [
      { q: '員工如何打卡？', a: '員工透過 LINE 輸入「打卡」或開啟 LIFF 打卡頁面。系統會驗證 GPS 位置和 WiFi。' },
      { q: '如何申請打卡補登？', a: '進入「出勤管理」→「補登申請」→「新增補登」→ 選擇員工、日期、類型（上班/下班）、時間和原因。主管審核後生效。' },
      { q: 'AI 自動排班怎麼用？', a: '進入「排班」→ 點擊「AI 自動排班」。系統會根據勞基法規定（每週 2 天休、班距 11 小時、最低人力）自動安排班表。' },
    ],
  },
  {
    title: 'LINE 整合',
    icon: '💬',
    articles: [
      { q: '員工如何綁定 LINE？', a: '員工加入官方帳號後，對 Bot 輸入「/註冊 姓名」即可自助綁定；或由管理員於「組織管理 → LINE 整合」頁面綁定。支援多 OA：同一員工可綁定於多個官方帳號。' },
      { q: 'LINE Bot 支援哪些指令？', a: '打卡、薪資、假期、任務、排休、庫存（+品名）。輸入「選單」可看完整功能列表。' },
      { q: '任務通知怎麼發送？', a: '新增任務指派給有綁定 LINE 的員工時，系統自動推播 Flex Message 通知，附帶 LIFF 連結可直接操作。' },
    ],
  },
]

export default function HelpCenter() {
  const [search, setSearch] = useState('')
  const [expandedSection, setExpandedSection] = useState(null)
  const [expandedArticle, setExpandedArticle] = useState(null)

  const filteredSections = HELP_SECTIONS.map(section => ({
    ...section,
    articles: section.articles.filter(a =>
      search === '' || a.q.toLowerCase().includes(search.toLowerCase()) || a.a.toLowerCase().includes(search.toLowerCase())
    ),
  })).filter(s => s.articles.length > 0)

  return (
    <div className="fade-in">
      <div className="page-header">
        <h2><span className="header-icon">📖</span> 說明中心</h2>
        <p>系統功能說明與常見問題</p>
      </div>

      {/* Search */}
      <div className="search-bar" style={{ marginBottom: 20 }}>
        <Search className="search-icon" />
        <input type="text" placeholder="搜尋問題..." className="form-input"
          style={{ paddingLeft: 38, width: '100%', maxWidth: 500 }}
          value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {/* Sections */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {filteredSections.map((section, si) => {
          const isOpen = expandedSection === section.title
          return (
            <div key={si} className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div onClick={() => setExpandedSection(isOpen ? null : section.title)} style={{
                padding: '14px 20px', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  <span style={{ fontSize: 18 }}>{section.icon}</span>
                  <span style={{ fontWeight: 700, fontSize: 15 }}>{section.title}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>({section.articles.length})</span>
                </div>
              </div>

              {isOpen && (
                <div style={{ borderTop: '1px solid var(--border-subtle)' }}>
                  {section.articles.map((article, ai) => {
                    const articleKey = `${si}-${ai}`
                    const isArticleOpen = expandedArticle === articleKey
                    return (
                      <div key={ai} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                        <div onClick={() => setExpandedArticle(isArticleOpen ? null : articleKey)} style={{
                          padding: '12px 20px 12px 48px', cursor: 'pointer',
                          display: 'flex', alignItems: 'center', gap: 8,
                        }}>
                          {isArticleOpen ? <ChevronDown size={14} color="var(--accent-cyan)" /> : <ChevronRight size={14} />}
                          <span style={{ fontSize: 14, fontWeight: 600 }}>{article.q}</span>
                        </div>
                        {isArticleOpen && (
                          <div style={{
                            padding: '0 20px 14px 68px',
                            fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7,
                          }}>
                            {article.a}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
