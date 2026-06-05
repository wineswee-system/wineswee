import { useState } from 'react'
import { ChevronRight, ChevronDown, Smartphone, Monitor, Shield, MessageCircle, HelpCircle } from 'lucide-react'

const SECTIONS = [
  {
    title: 'Part 1：員工端（LINE LIFF）',
    icon: '📱',
    color: 'var(--accent-green)',
    items: [
      {
        title: '1-1 打卡上下班',
        content: `**操作步驟：**
1. 打開 LINE → 點選 SME Ops 官方帳號
2. 點選 Rich Menu 的「打卡」
3. 系統自動偵測 GPS 位置
4. 確認位置正確 → 點「打卡」按鈕
5. 顯示打卡成功（時間、地點、IP）

**注意事項：**
• 需在門市 150 公尺範圍內
• 支援 GPS + WiFi 雙重驗證
• 忘記打下班卡 → 系統凌晨 6:00 自動推播提醒`
      },
      {
        title: '1-2 查看我的班表',
        content: `**操作步驟：**
1. LINE → SME Ops → 點「我的班表」
2. 顯示本週/本月排班
3. 可看到班別時間、休假日`
      },
      {
        title: '1-3 請假申請',
        content: `**操作步驟：**
1. LINE → SME Ops → 點「請假」
2. 選擇假別（特休/病假/事假...）
3. 選擇日期範圍
4. 填寫請假原因
5. 點「提交」→ 系統自動通知主管審核

**假別說明：**
• 特休 — 依年資計算天數（全薪）
• 病假 — 需附證明（半薪）
• 事假 — 個人事務（無薪）
• 婚假 — 8天（全薪）
• 喪假 — 依親等3-8天（全薪）`
      },
      {
        title: '1-4 加班申請',
        content: `**操作步驟：**
1. LINE → SME Ops → 點「加班申請」
2. 選擇日期、填寫加班時數
3. 填寫加班原因
4. 提交 → 等待主管審核`
      },
      {
        title: '1-5 補打卡申請',
        content: `**適用情況：** 忘記打卡、系統異常

**操作步驟：**
1. LINE → SME Ops → 點「補打卡」
2. 選擇日期
3. 選擇類型（上班/下班）
4. 填寫正確時間 + 原因
5. 提交 → 等待主管審核

**自動提醒機制：**
每天凌晨 6:00 系統自動掃描，有上班卡但沒下班卡 → LINE 推播提醒`
      },
      {
        title: '1-6 查薪水',
        content: `**操作步驟：**
1. LINE → SME Ops → 點「查薪水」
2. 選擇月份
3. 顯示薪資明細（底薪、津貼、加班費、扣款、實發）`
      },
      {
        title: '1-7 費用申請（先申請後核銷(驗收)）',
        content: `**申請步驟：**
1. LINE → SME Ops → 點「費用申請」
2. 選擇「費用」或「非費用」
3. 選擇會計科目
4. 填寫品項明細（品名、數量、單價）
5. 可拍照上傳訂購單/報價單
6. 提交 → 依金額走對應簽核鏈

**核銷(驗收)步驟：**
1. 核准後 → 進行採購
2. 買完後點「核銷(驗收)」→ 填實際金額 + 上傳收據
3. 財務確認 → 自動產生傳票

**金額分級簽核：**
• ≤ $3,000 → 主管審核（1關）
• $3,001~$10,000 → 主管 + 部門主管（2關）
• > $10,000 → 主管 + 部門主管 + 財務（3關）`
      },
      {
        title: '1-8 報帳',
        content: `**適用情況：** 已經花費的費用報帳（出差交通費、餐費等）

**操作步驟：**
1. LINE → SME Ops → 點「報帳」
2. 選擇分類（交通/住宿/餐飲/設備/其他）
3. 填寫金額、日期、說明
4. 可上傳收據
5. 提交 → 主管審核 → 財務核銷(驗收)`
      },
    ]
  },
  {
    title: 'Part 2：主管端（後台系統）',
    icon: '💻',
    color: 'var(--accent-blue)',
    items: [
      {
        title: '2-1 登入系統',
        content: `**登入方式：**
• Google 帳號登入（推薦）
• Facebook 帳號登入
• Email + 密碼登入

**登入後自動綁定：**
系統依據登入 email 自動對應員工資料，無需額外設定。

**網址：** https://sme-ops-system.vercel.app`
      },
      {
        title: '2-2 排班管理',
        content: `**操作步驟：**
1. 人員組織 → 出勤管理 → 排班
2. 選擇門市、月份
3. 點選日期格子 → 選擇班別
4. 排完後點「發布」→ 自動推送 LINE 通知

**功能：**
• 月曆式排班表
• 拖拉排班
• AI 自動排班建議
• 發布班表 → LINE 通知員工`
      },
      {
        title: '2-3 審核管理',
        content: `**審核項目：** 請假、加班、補打卡、費用申請

**操作步驟：**
1. 收到 LINE 通知「有新的簽核請求」
2. 進入系統 → 流程管理 → 簽核設定
3. 查看待審核項目
4. 點「核准」或「退回」（退回需填原因）`
      },
      {
        title: '2-4 出勤報表',
        content: `**操作步驟：**
1. 人員組織 → 出勤管理 → 打卡追蹤
2. 選擇日期
3. 查看所有員工打卡狀態

**功能：**
• 每日出勤紀錄
• 遲到/早退統計
• 班表 vs 實際出勤比對`
      },
    ]
  },
  {
    title: 'Part 3：管理端',
    icon: '⚙️',
    color: 'var(--accent-purple)',
    items: [
      {
        title: '3-1 組織架構',
        content: `**功能：**
• 部門管理（新增/編輯/指定主管）
• 門市管理（新增門市、設定打卡範圍）
• 員工管理（新增/編輯/設定權限）
• 組織圖（自動生成層級圖）`
      },
      {
        title: '3-2 專案管理',
        content: `**三層架構：** Project → Workflow → Task

**操作步驟：**
1. 流程管理 → 專案
2. 可從「專案模板」一鍵部署
3. 或手動新增專案
4. 專案底下建立多個流程（可平行執行）
5. 每個流程底下有多個任務
6. 進度自動計算

**內建模板：**
• 門市裝潢翻新（3流程/10任務/14天）
• 新人到職 SOP（2流程/8任務/7天）
• 月底門市盤點（1流程/5任務/5天）`
      },
      {
        title: '3-3 流程管理',
        content: `**功能：**
• 建立流程範本
• 部署流程到門市
• 追蹤每個步驟進度
• AI 助手建議流程

**流程狀態追蹤：**
每個流程顯示進度圓餅圖 + 任務完成比`
      },
      {
        title: '3-4 簽核設定',
        content: `**兩種簽核：**
1. 一般簽核 — 手動指定簽核人和步驟
2. 費用簽核 — 依金額自動分級（小/中/大額）

**費用簽核設定步驟：**
1. 流程管理 → 費用簽核設定
2. 設定金額範圍 + 簽核步驟
3. 員工提交費用申請時自動匹配`
      },
    ]
  },
  {
    title: 'Part 4：LINE 整合',
    icon: '💬',
    color: 'var(--accent-green)',
    items: [
      {
        title: '4-1 LINE 通知類型',
        content: `**自動推播通知：**

| 通知類型 | 觸發時機 |
|---------|---------|
| 班表發布 | 主管發布排班後 |
| 簽核請求 | 有人提交需審核項目 |
| 簽核結果 | 申請被核准/退回 |
| 未打卡提醒 | 凌晨 6:00 偵測未打下班卡 |
| 任務指派 | 有新任務指派 |`
      },
      {
        title: '4-2 員工綁定',
        content: `**綁定流程：**
1. 員工加入 LINE 官方帳號
2. 系統自動取得 LINE User ID
3. 管理員在員工資料綁定 LINE ID
4. 綁定後即可收到所有通知`
      },
    ]
  },
  {
    title: '系統權限說明',
    icon: '🛡️',
    color: 'var(--accent-yellow)',
    items: [
      {
        title: '權限等級',
        content: `| 角色 | 可使用功能 |
|------|-----------|
| 一般員工 (staff) | LIFF 打卡/請假/班表/薪水 |
| 主管 (manager) | 上述 + 後台人資/流程管理 |
| 管理員 (admin) | 上述 + 財務會計 |
| 超級管理員 (super_admin) | 全部功能 |

**設定方式：**
人員組織 → 員工 → 編輯 → 系統權限`
      },
    ]
  },
  {
    title: '常見問題 FAQ',
    icon: '❓',
    color: 'var(--accent-cyan)',
    items: [
      {
        title: '打卡相關',
        content: `**Q: 打卡失敗怎麼辦？**
A: 確認 GPS 已開啟，在門市 150m 範圍內。如仍失敗，提交補打卡申請。

**Q: 忘記打下班卡？**
A: 系統會在凌晨 6:00 自動推 LINE 提醒，請至補打卡申請提交。`
      },
      {
        title: '費用相關',
        content: `**Q: 費用申請和報帳有什麼不同？**
A: 費用申請是「先申請後購買」，報帳是「已經花費的費用報銷」。

**Q: 費用申請的簽核流程是怎麼決定的？**
A: 依金額自動匹配：3千以下1關、3千~1萬2關、1萬以上3關。`
      },
      {
        title: '系統相關',
        content: `**Q: 如何變更員工權限？**
A: 人員組織 → 員工 → 編輯 → 系統權限下拉選單。

**Q: 專案和流程的關係？**
A: 專案包含多個流程，流程包含多個任務。流程之間可以平行執行。`
      },
    ]
  },
]

// Simple markdown-ish renderer
function RenderContent({ text }) {
  const lines = text.split('\n')
  return (
    <div style={{ fontSize: 13, lineHeight: 1.8 }}>
      {lines.map((line, i) => {
        const trimmed = line.trim()
        if (!trimmed) return <div key={i} style={{ height: 8 }} />
        if (trimmed.startsWith('**') && trimmed.endsWith('**')) return <div key={i} style={{ fontWeight: 700, marginTop: 8 }}>{trimmed.slice(2, -2)}</div>
        if (trimmed.startsWith('**') && trimmed.includes('**')) {
          const parts = trimmed.split('**')
          return <div key={i}>{parts.map((p, j) => j % 2 === 1 ? <strong key={j}>{p}</strong> : p)}</div>
        }
        if (trimmed.startsWith('•')) return <div key={i} style={{ paddingLeft: 16 }}>{trimmed}</div>
        if (/^\d+\./.test(trimmed)) return <div key={i} style={{ paddingLeft: 8 }}>{trimmed}</div>
        if (trimmed.startsWith('|')) {
          // Table row
          const cells = trimmed.split('|').filter(Boolean).map(c => c.trim())
          if (cells.every(c => /^-+$/.test(c))) return null
          return (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: `repeat(${cells.length}, 1fr)`, gap: 4, padding: '4px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              {cells.map((c, j) => <div key={j} style={{ fontSize: 12 }}>{c}</div>)}
            </div>
          )
        }
        return <div key={i}>{trimmed}</div>
      })}
    </div>
  )
}

export default function TrainingGuide() {
  const [expandedSection, setExpandedSection] = useState(0)
  const [expandedItem, setExpandedItem] = useState(null)

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">📖</span> 系統教學手冊</h2>
            <p>SME Ops 完整操作教學 — 可提供給客戶做員工培訓</p>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 20 }}>
        {/* Sidebar TOC */}
        <div>
          {SECTIONS.map((section, si) => (
            <div key={si} style={{ marginBottom: 4 }}>
              <button onClick={() => { setExpandedSection(si); setExpandedItem(null) }}
                style={{
                  width: '100%', textAlign: 'left', padding: '10px 12px', borderRadius: 8,
                  border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
                  background: expandedSection === si ? `color-mix(in srgb, ${section.color} 15%, transparent)` : 'transparent',
                  color: expandedSection === si ? section.color : 'var(--text-secondary)',
                }}>
                {section.icon} {section.title}
              </button>
              {expandedSection === si && section.items.map((item, ii) => (
                <button key={ii} onClick={() => setExpandedItem(ii)}
                  style={{
                    width: '100%', textAlign: 'left', padding: '6px 12px 6px 32px',
                    border: 'none', cursor: 'pointer', fontSize: 12, borderRadius: 6,
                    background: expandedItem === ii ? 'var(--accent-cyan-dim)' : 'transparent',
                    color: expandedItem === ii ? 'var(--accent-cyan)' : 'var(--text-muted)',
                    fontWeight: expandedItem === ii ? 600 : 400,
                  }}>
                  {item.title}
                </button>
              ))}
            </div>
          ))}
        </div>

        {/* Content */}
        <div>
          {SECTIONS[expandedSection] && (
            <div>
              <h3 style={{ fontSize: 18, fontWeight: 800, color: SECTIONS[expandedSection].color, marginBottom: 16 }}>
                {SECTIONS[expandedSection].icon} {SECTIONS[expandedSection].title}
              </h3>
              {SECTIONS[expandedSection].items.map((item, ii) => (
                <div key={ii} className="card" style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '4px 0' }}
                    onClick={() => setExpandedItem(expandedItem === ii ? null : ii)}>
                    {expandedItem === ii ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    <span style={{ fontSize: 15, fontWeight: 700 }}>{item.title}</span>
                  </div>
                  {expandedItem === ii && (
                    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border-subtle)' }}>
                      <RenderContent text={item.content} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
