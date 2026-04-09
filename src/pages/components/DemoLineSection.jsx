import { useState } from 'react'
import { Check } from 'lucide-react'

// ── Interactive LINE Phone (hover to switch screen) ──
function InteractiveLinePhone() {
  const [activeScreen, setActiveScreen] = useState('clock')
  const screens = {
    clock: { header: '打卡結果', headerBg: '#EFF9FB', headerColor: '#0E7490', title: '上班打卡成功', rows: [['員工', '王小明'], ['時間', '08:52'], ['方式', 'GPS 驗證']] },
    salary: { header: '2026-04 薪資', headerBg: '#ECFDF5', headerColor: '#047857', title: 'NT$ 45,800', rows: [['底薪', 'NT$ 40,000'], ['加班費', '+5,200'], ['津貼', '+3,000']] },
    leave: { header: '請假申請', headerBg: '#EFF6FF', headerColor: '#1D4ED8', title: '已送出審核', rows: [['假別', '特休假'], ['日期', '04/15~04/16'], ['狀態', '待主管核准']] },
    stock: { header: '庫存查詢', headerBg: '#FFF7ED', headerColor: '#C2410C', title: '12 項低庫存', rows: [['有機牛奶', '45 / 50'], ['鮮奶油', '8 / 20'], ['雞胸肉', '150 / 80']] },
  }
  const s = screens[activeScreen]

  return (
    <div className="demo-line-phone-col">
      <div className="demo-phone" style={{ background: '#e8e8e8' }}>
        <div className="demo-phone-top"><span>SME OPS</span><span style={{ opacity: 0.6, fontSize: 10 }}>官方帳號</span></div>
        <div className="demo-phone-chat">
          <div className="demo-msg-r">{activeScreen === 'clock' ? '打卡' : activeScreen === 'salary' ? '薪資' : activeScreen === 'leave' ? '請假' : '庫存'}</div>
          <div className="demo-msg-l" key={activeScreen}>
            <div style={{ background: s.headerBg, padding: '10px 14px' }}>
              <div style={{ fontSize: 10, color: `${s.headerColor}99`, fontWeight: 600 }}>{s.header}</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: s.headerColor, marginTop: 2 }}>{s.title}</div>
            </div>
            <div style={{ padding: '8px 14px', fontSize: 11, color: '#555' }}>
              {s.rows.map(([k, v], i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span>{k}</span><span style={{ fontWeight: 600, color: '#222' }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="demo-line-triggers">
        {[
          { key: 'clock', label: '打卡' },
          { key: 'salary', label: '薪資' },
          { key: 'leave', label: '請假' },
          { key: 'stock', label: '庫存' },
        ].map(t => (
          <button
            key={t.key}
            className={`demo-line-trigger ${activeScreen === t.key ? 'active' : ''}`}
            onMouseEnter={() => setActiveScreen(t.key)}
            onClick={() => setActiveScreen(t.key)}
          >{t.label}</button>
        ))}
      </div>
      <div className="demo-line-phone-label">
        <strong>互動體驗</strong>
        <span>滑過上方按鈕，即時切換畫面</span>
      </div>
    </div>
  )
}

export default function DemoLineSection() {
  return (
    <>
      {/* 3 phones side by side */}
      <div className="demo-line-phones">

        {/* Phone 1: Interactive — hover to switch */}
        <InteractiveLinePhone />

        {/* Phone 2: LIFF 員工首頁 */}
        <div className="demo-line-phone-col">
          <div className="demo-phone" style={{ background: '#f0f2f5' }}>
            <div style={{ background: '#fff', padding: '12px 14px', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'rgba(8,145,178,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, color: '#0891B2' }}>王</div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>午安，王小明</div>
                  <div style={{ fontSize: 10, color: '#94a3b8' }}>研發部 · 資深工程師</div>
                </div>
              </div>
            </div>
            <div style={{ padding: '8px 12px', display: 'flex', gap: 6 }}>
              <div style={{ flex: 1, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', borderRadius: 8, padding: '7px 10px' }}>
                <div style={{ fontSize: 9, color: '#94a3b8' }}>出勤</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#0891B2' }}>已上班</div>
              </div>
              <div style={{ flex: 1, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', borderRadius: 8, padding: '7px 10px' }}>
                <div style={{ fontSize: 9, color: '#94a3b8' }}>待辦</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#EA580C' }}>3 項任務</div>
              </div>
              <div style={{ flex: 1, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', borderRadius: 8, padding: '7px 10px' }}>
                <div style={{ fontSize: 9, color: '#94a3b8' }}>假單</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#059669' }}>已核准</div>
              </div>
            </div>
            <div style={{ padding: '0 12px 8px' }}>
              <div style={{ background: 'linear-gradient(135deg, rgba(234,88,12,0.08), rgba(220,38,38,0.08))', border: '1px solid rgba(234,88,12,0.15)', borderRadius: 10, padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#1e293b' }}>點我下班打卡</div>
                  <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 1 }}>上班 08:52</div>
                </div>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg, #fb923c, #f87171)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: '#fff' }}>👋</div>
              </div>
            </div>
            <div style={{ padding: '0 12px 8px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#1e293b', marginBottom: 6 }}>功能選單</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 5 }}>
                {[
                  { icon: '⏰', label: '打卡', bg: 'rgba(8,145,178,0.1)' },
                  { icon: '💰', label: '查薪水', bg: 'rgba(5,150,105,0.1)' },
                  { icon: '📋', label: '請假', bg: 'rgba(37,99,235,0.1)' },
                  { icon: '📦', label: '查庫存', bg: 'rgba(234,88,12,0.1)' },
                  { icon: '⚙️', label: '流程', bg: 'rgba(124,58,237,0.1)' },
                  { icon: '🧾', label: '報帳', bg: 'rgba(217,119,6,0.1)' },
                  { icon: '📅', label: '排休', bg: 'rgba(8,145,178,0.1)' },
                  { icon: '🤝', label: '客戶', bg: 'rgba(219,39,119,0.1)' },
                ].map(m => (
                  <div key={m.label} style={{ background: '#fff', border: '1px solid rgba(0,0,0,0.05)', borderRadius: 8, padding: '8px 4px', textAlign: 'center' }}>
                    <div style={{ width: 28, height: 28, borderRadius: 7, background: m.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, margin: '0 auto 3px' }}>{m.icon}</div>
                    <div style={{ fontSize: 9, fontWeight: 600, color: '#64748b' }}>{m.label}</div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', background: '#fff', borderTop: '1px solid rgba(0,0,0,0.06)', padding: '6px 0' }}>
              {['首頁', '打卡', '請假', '庫存'].map((t, i) => (
                <div key={t} style={{ textAlign: 'center', fontSize: 9, color: i === 0 ? '#0891B2' : '#94a3b8', fontWeight: 500 }}>{t}</div>
              ))}
            </div>
          </div>
          <div className="demo-line-phone-label">
            <strong>員工行動工作台</strong>
            <span>在 LINE 裡直接開，8 大功能一鍵操作</span>
          </div>
        </div>

        {/* Phone 3: 主管簽核 + Rich Menu */}
        <div className="demo-line-phone-col">
          <div className="demo-phone" style={{ background: '#e8e8e8' }}>
            <div className="demo-phone-top"><span>SME OPS</span><span style={{ opacity: 0.6, fontSize: 10 }}>官方帳號</span></div>
            <div className="demo-phone-chat" style={{ minHeight: 160 }}>
              <div className="demo-msg-l" style={{ width: '82%' }}>
                <div style={{ background: '#FEF3C7', padding: '10px 14px' }}>
                  <div style={{ fontSize: 10, color: '#92400E', fontWeight: 600 }}>簽核通知</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#78350F', marginTop: 2 }}>李美玲 申請特休假</div>
                </div>
                <div style={{ padding: '8px 14px', fontSize: 11, color: '#555' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}><span>日期</span><span style={{ fontWeight: 600, color: '#222' }}>04/15 ~ 04/16</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}><span>天數</span><span style={{ fontWeight: 600, color: '#222' }}>2 天</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>事由</span><span style={{ fontWeight: 600, color: '#222' }}>家庭旅遊</span></div>
                </div>
                <div style={{ padding: '6px 14px 10px', display: 'flex', gap: 6 }}>
                  <div style={{ flex: 1, textAlign: 'center', padding: '6px', borderRadius: 6, background: '#059669', color: '#fff', fontSize: 12, fontWeight: 700 }}>核准</div>
                  <div style={{ flex: 1, textAlign: 'center', padding: '6px', borderRadius: 6, background: '#f1f5f9', color: '#64748b', fontSize: 12, fontWeight: 600 }}>退回</div>
                </div>
              </div>
              <div className="demo-msg-r">核准</div>
              <div className="demo-msg-l" style={{ width: '75%' }}>
                <div style={{ padding: '10px 14px', fontSize: 12, color: '#059669', fontWeight: 600 }}>
                  ✓ 已核准李美玲的特休假申請
                </div>
              </div>
            </div>
            {/* Rich Menu */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', background: '#f6f8fa' }}>
              {[
                { icon: '✍️', label: '待簽核', color: '#EA580C' },
                { icon: '📊', label: '營運數據', color: '#2563EB' },
                { icon: '👥', label: '員工狀態', color: '#0891B2' },
              ].map(m => (
                <div key={m.label} style={{ background: '#fff', padding: '10px 6px', textAlign: 'center', borderRight: '1px solid rgba(0,0,0,0.04)', borderTop: '1px solid rgba(0,0,0,0.04)' }}>
                  <div style={{ width: 30, height: 30, borderRadius: 8, background: `${m.color}12`, border: `1px solid ${m.color}20`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, margin: '0 auto 3px' }}>{m.icon}</div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#1e293b' }}>{m.label}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="demo-line-phone-label">
            <strong>主管行動簽核</strong>
            <span>假單、採購單，LINE 上直接核准或退回</span>
          </div>
        </div>
      </div>

      {/* Feature pills */}
      <div className="demo-line-pills">
        {[
          '不用另外裝 App',
          'GPS + WiFi 雙重打卡驗證',
          '14 種假別線上申請',
          '薪資明細即時查詢',
          '庫存低量自動推播',
          '主管隨時隨地簽核',
          '排休月曆一目瞭然',
          '班表提醒自動推播',
        ].map(f => (
          <span key={f} className="demo-line-pill"><Check size={11} /> {f}</span>
        ))}
      </div>
    </>
  )
}
