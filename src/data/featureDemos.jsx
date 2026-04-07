import { MockTable, MockStat, MockBadge, MockBtn, MockField, MockCard, MockRow } from '../components/ui/FeatureCarousel'
import {
  Users, CreditCard, ShoppingCart, Warehouse, Building2,
  HeadphonesIcon, Check, Monitor, PieChart, Shield, Factory,
} from 'lucide-react'

/* ════════════════════════════════
   Each module: 3-5 steps
   step = { title, desc, screenTitle, screen: JSX }
   ════════════════════════════════ */

// ━━━━━━━━━━━━━━━━━━━━ HR 人事管理 ━━━━━━━━━━━━━━━━━━━━
export const HR_STEPS = [
  {
    title: '員工 GPS 打卡',
    desc: '員工到門市後按下打卡，系統自動比對 GPS 座標和 WiFi IP，確認在合理範圍內才算有效打卡。',
    screenTitle: 'HR / 出勤管理',
    screen: (
      <div>
        <MockRow>
          <MockStat label="今日出勤" value="23/25" color="#059669" />
          <MockStat label="遲到" value="1" color="#d97706" />
          <MockStat label="請假中" value="1" color="#2563eb" />
        </MockRow>
        <MockCard title="王小明 — 打卡紀錄">
          <MockRow>
            <MockField label="上班打卡" value="08:52" />
            <MockField label="驗證方式" value="GPS 定位 + WiFi" />
          </MockRow>
          <MockRow>
            <MockField label="門市" value="台北信義店" />
            <MockField label="狀態" value={<MockBadge color="#059669">正常</MockBadge>} />
          </MockRow>
        </MockCard>
      </div>
    ),
  },
  {
    title: '假單申請與主管簽核',
    desc: '員工選擇假別和日期後送出，系統自動判斷假別餘額，並通知直屬主管審核（LINE 即時推播）。',
    screenTitle: 'HR / 請假管理',
    screen: (
      <div>
        <MockCard title="請假申請">
          <MockRow>
            <MockField label="假別" value="特休假" />
            <MockField label="剩餘" value="7 天" />
          </MockRow>
          <MockRow>
            <MockField label="日期" value="2026/04/10 ~ 04/11" />
            <MockField label="天數" value="2 天" />
          </MockRow>
          <MockField label="事由" value="家庭旅遊" />
          <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
            <MockBtn primary>送出申請</MockBtn>
            <MockBtn>取消</MockBtn>
          </div>
        </MockCard>
      </div>
    ),
  },
  {
    title: '薪資計算與明細',
    desc: '系統根據出勤、請假、加班、扣款自動計算月薪，每筆扣款都有明確分類和計算依據。',
    screenTitle: 'HR / 薪資管理',
    screen: (
      <div>
        <MockCard title="2026-04 薪資明細 — 王小明">
          <MockTable
            headers={['項目', '金額']}
            rows={[
              ['底薪', 'NT$ 40,000'],
              ['職務津貼', '+3,000'],
              ['加班費（12 hr）', '+5,200'],
              ['事假扣薪（1 天）', '-1,333'],
              ['勞保自付', '-1,042'],
              ['健保自付', '-826'],
            ]}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontWeight: 700, fontSize: 13 }}>
            <span>實發薪資</span>
            <span style={{ color: '#059669' }}>NT$ 44,999</span>
          </div>
        </MockCard>
      </div>
    ),
  },
  {
    title: '智慧排班與法規檢核',
    desc: '拖拉式排班，系統即時檢查勞基法（七休一、連續工時上限），違規時自動標紅警示。',
    screenTitle: 'HR / 排班系統',
    screen: (
      <div>
        <MockCard title="本週排班 — 台北信義店">
          <MockTable
            headers={['員工', '一', '二', '三', '四', '五', '六', '日']}
            rows={[
              ['王小明', '早', '早', '晚', '休', '早', '早', '休'],
              ['李美玲', '晚', '休', '早', '早', '晚', '休', '早'],
              ['張大偉', '休', '早', '早', '晚', '休', '早', '早'],
            ]}
          />
          <div style={{ marginTop: 8, fontSize: 11, color: '#059669', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Check size={12} /> 排班合規檢核通過（勞基法 / 性平法）
          </div>
        </MockCard>
      </div>
    ),
  },
  {
    title: '績效考核與獎金',
    desc: '設定 KPI 項目與權重，考核結果自動連動獎金計算，主管可線上評分並留下評語。',
    screenTitle: 'HR / 績效管理',
    screen: (
      <div>
        <MockCard title="2026 Q1 績效 — 王小明">
          <MockTable
            headers={['KPI 項目', '目標', '實際', '達成率']}
            rows={[
              ['業績達標', '$500K', '$620K', <MockBadge color="#059669">124%</MockBadge>],
              ['客戶滿意度', '90%', '92%', <MockBadge color="#059669">102%</MockBadge>],
              ['專案準時率', '95%', '88%', <MockBadge color="#d97706">93%</MockBadge>],
            ]}
          />
          <MockRow>
            <MockField label="綜合評等" value={<MockBadge color="#059669">A</MockBadge>} />
            <MockField label="獎金" value="NT$ 15,000" />
          </MockRow>
        </MockCard>
      </div>
    ),
  },
]

// ━━━━━━━━━━━━━━━━━━━━ CRM 客戶管理 ━━━━━━━━━━━━━━━━━━━━
export const CRM_STEPS = [
  {
    title: '客戶 360° 全視角',
    desc: '一個畫面看到客戶所有資訊：基本資料、交易紀錄、客服工單、行銷互動、合約狀態。',
    screenTitle: 'CRM / 客戶 360°',
    screen: (
      <div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, background: '#2563eb15', color: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14 }}>好</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13 }}>好吃餐飲有限公司</div>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>VIP 客戶 · 合作 2 年</div>
          </div>
        </div>
        <MockRow>
          <MockStat label="累計營收" value="$2.4M" color="#059669" />
          <MockStat label="進行中訂單" value="3" color="#2563eb" />
          <MockStat label="待處理工單" value="1" color="#d97706" />
        </MockRow>
        <MockCard title="最近交易">
          <MockTable headers={['日期', '品項', '金額']} rows={[['04/01', '食材 A 批', '$45,000'], ['03/15', '設備維護', '$12,000']]} />
        </MockCard>
      </div>
    ),
  },
  {
    title: '銷售漏斗追蹤',
    desc: '從潛在客戶到成交，每個階段的商機數量和金額一目瞭然，拖拉即可更新階段。',
    screenTitle: 'CRM / 銷售漏斗',
    screen: (
      <div>
        <MockRow>
          <MockStat label="漏斗總額" value="$8.2M" color="#7c3aed" />
          <MockStat label="進行中" value="24" color="#2563eb" />
          <MockStat label="本月成交" value="$1.6M" color="#059669" />
        </MockRow>
        <MockCard>
          <div style={{ display: 'flex', gap: 6 }}>
            {[
              { stage: '接洽中', n: 8, color: '#94a3b8' },
              { stage: '需求確認', n: 6, color: '#2563eb' },
              { stage: '報價中', n: 5, color: '#d97706' },
              { stage: '議價', n: 3, color: '#7c3aed' },
              { stage: '成交', n: 2, color: '#059669' },
            ].map(s => (
              <div key={s.stage} style={{ flex: 1, textAlign: 'center', padding: '8px 4px', borderRadius: 6, background: `${s.color}10`, fontSize: 10 }}>
                <div style={{ fontWeight: 700, color: s.color, fontSize: 16 }}>{s.n}</div>
                <div style={{ color: '#64748b', marginTop: 2 }}>{s.stage}</div>
              </div>
            ))}
          </div>
        </MockCard>
      </div>
    ),
  },
  {
    title: '行銷自動化 Drip Campaign',
    desc: '設定觸發條件和行銷流程，系統自動發送 Email、LINE 訊息，追蹤開信率和轉換率。',
    screenTitle: 'CRM / 行銷自動化',
    screen: (
      <div>
        <MockCard title="春季促銷 Drip Campaign">
          <MockRow>
            <MockField label="狀態" value={<MockBadge color="#059669">執行中</MockBadge>} />
            <MockField label="已觸發" value="342 人" />
          </MockRow>
          <MockTable headers={['步驟', '動作', '完成率']} rows={[['Day 0', '歡迎信', '89%'], ['Day 3', '產品介紹', '67%'], ['Day 7', '限時優惠', '45%'], ['Day 14', '跟進提醒', '進行中']]} />
        </MockCard>
      </div>
    ),
  },
  {
    title: '客服工單管理',
    desc: '客戶問題統一建單追蹤，指派負責人、設定優先度，確保每個問題都有人處理。',
    screenTitle: 'CRM / 客服工單',
    screen: (
      <div>
        <MockRow>
          <MockStat label="待處理" value="5" color="#ef4444" />
          <MockStat label="處理中" value="8" color="#d97706" />
          <MockStat label="已結案" value="142" color="#059669" />
        </MockRow>
        <MockTable headers={['工單', '客戶', '優先度', '狀態']} rows={[
          ['#T-0891', '好吃餐飲', <MockBadge color="#ef4444">緊急</MockBadge>, <MockBadge color="#d97706">處理中</MockBadge>],
          ['#T-0890', '大方貿易', <MockBadge color="#d97706">中</MockBadge>, <MockBadge color="#059669">已回覆</MockBadge>],
          ['#T-0889', '科技新創', <MockBadge color="#2563eb">低</MockBadge>, <MockBadge color="#059669">已結案</MockBadge>],
        ]} />
      </div>
    ),
  },
]

// ━━━━━━━━━━━━━━━━━━━━ WMS 倉儲管理 ━━━━━━━━━━━━━━━━━━━━
export const WMS_STEPS = [
  {
    title: '即時庫存總覽',
    desc: '所有商品的即時庫存量、安全存量、儲位分佈，低庫存品項自動標示警示。',
    screenTitle: 'WMS / 庫存管理',
    screen: (
      <div>
        <MockRow>
          <MockStat label="總 SKU" value="1,247" />
          <MockStat label="低庫存警示" value="12" color="#ef4444" />
          <MockStat label="本月入庫" value="340" color="#059669" />
        </MockRow>
        <MockTable headers={['商品', '庫存', '安全量', '狀態']} rows={[
          ['A001 有機牛奶', '45', '50', <MockBadge color="#ef4444">低庫存</MockBadge>],
          ['B012 全麥吐司', '200', '100', <MockBadge color="#059669">正常</MockBadge>],
          ['C003 鮮奶油', '8', '20', <MockBadge color="#ef4444">低庫存</MockBadge>],
          ['D045 雞胸肉', '150', '80', <MockBadge color="#059669">正常</MockBadge>],
        ]} />
      </div>
    ),
  },
  {
    title: '進貨入庫作業',
    desc: '掃描條碼或手動輸入，系統自動比對採購單，驗收後庫存即時更新。',
    screenTitle: 'WMS / 進貨入庫',
    screen: (
      <div>
        <MockCard title="進貨單 #PO-2026-0412">
          <MockRow>
            <MockField label="供應商" value="統一食品" />
            <MockField label="採購單" value="PO-20260410" />
          </MockRow>
          <MockTable headers={['品項', '訂購', '到貨', '驗收']} rows={[
            ['有機牛奶', '100', '100', <MockBadge color="#059669">合格</MockBadge>],
            ['鮮奶油', '50', '48', <MockBadge color="#d97706">短少 2</MockBadge>],
            ['雞胸肉', '80', '80', <MockBadge color="#059669">合格</MockBadge>],
          ]} />
          <div style={{ marginTop: 10 }}><MockBtn primary>確認入庫</MockBtn></div>
        </MockCard>
      </div>
    ),
  },
  {
    title: '出貨自動拋帳',
    desc: '出貨完成後系統自動建立應收帳款和會計傳票，不需要再手動到財務系統建帳。',
    screenTitle: 'WMS / 出貨管理',
    screen: (
      <div>
        <MockCard title="出貨單 #SO-2026-0856">
          <MockRow>
            <MockField label="客戶" value="好吃餐飲" />
            <MockField label="狀態" value={<MockBadge color="#059669">已出貨</MockBadge>} />
          </MockRow>
          <MockTable headers={['品項', '數量', '單價', '小計']} rows={[['有機牛奶', '30', '$45', '$1,350'], ['全麥吐司', '50', '$35', '$1,750']]} />
          <div style={{ borderTop: '1px solid #e2e8f0', marginTop: 8, paddingTop: 8, fontSize: 11, color: '#64748b' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Check size={12} style={{ color: '#059669' }} /> 已自動建立應收帳款 AR-2026-0856（$3,100）</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3 }}><Check size={12} style={{ color: '#059669' }} /> 已自動建立會計傳票 JV-2026-1203</div>
          </div>
        </MockCard>
      </div>
    ),
  },
  {
    title: '盤點作業',
    desc: '建立盤點單、指派人員，盤點結果自動計算差異，盤盈盤虧即時調整庫存帳。',
    screenTitle: 'WMS / 盤點作業',
    screen: (
      <div>
        <MockCard title="盤點單 #SC-2026-004">
          <MockRow>
            <MockField label="倉庫" value="台北主倉" />
            <MockField label="盤點日" value="2026/04/05" />
          </MockRow>
          <MockTable headers={['品項', '系統數', '實際數', '差異']} rows={[
            ['有機牛奶', '45', '43', <MockBadge color="#ef4444">-2</MockBadge>],
            ['全麥吐司', '200', '200', <MockBadge color="#059669">0</MockBadge>],
            ['雞胸肉', '150', '152', <MockBadge color="#d97706">+2</MockBadge>],
          ]} />
          <div style={{ marginTop: 8 }}><MockBtn primary>確認調整庫存</MockBtn></div>
        </MockCard>
      </div>
    ),
  },
]

// ━━━━━━━━━━━━━━━━━━━━ 財務會計 ━━━━━━━━━━━━━━━━━━━━
export const FINANCE_STEPS = [
  {
    title: '財務總覽儀表板',
    desc: '資產、負債、營收、毛利一目瞭然，帳齡分析即時呈現，掌握現金流動態。',
    screenTitle: '財務 / 總覽',
    screen: (
      <div>
        <MockRow>
          <MockStat label="本月營收" value="$3.2M" color="#059669" />
          <MockStat label="應收帳款" value="$890K" color="#d97706" />
          <MockStat label="毛利率" value="34.2%" color="#2563eb" />
        </MockRow>
        <MockCard title="應收帳齡分析">
          <MockTable headers={['帳齡', '金額', '筆數']} rows={[['0-30 天', '$420,000', '15'], ['31-60 天', '$280,000', '8'], ['61-90 天', '$130,000', '4'], ['90+ 天', '$60,000', '2']]} />
        </MockCard>
      </div>
    ),
  },
  {
    title: '傳票自動產生',
    desc: '跨模組操作完成後系統自動建立對應會計傳票，借貸自動平衡，減少人工作帳。',
    screenTitle: '財務 / 傳票管理',
    screen: (
      <div>
        <MockCard title="傳票 JV-2026-1203">
          <MockRow>
            <MockField label="日期" value="2026/04/07" />
            <MockField label="來源" value={<MockBadge color="#2563eb">自動 — 出貨</MockBadge>} />
          </MockRow>
          <MockTable headers={['科目', '借方', '貸方']} rows={[['應收帳款', '$3,100', ''], ['銷貨收入', '', '$3,100']]} />
          <div style={{ marginTop: 6, fontSize: 11, color: '#059669', display: 'flex', alignItems: 'center', gap: 4 }}><Check size={12} /> 借貸平衡 — 自動過帳完成</div>
        </MockCard>
      </div>
    ),
  },
  {
    title: '財務報表產出',
    desc: '資產負債表、損益表、現金流量表，選擇期間後一鍵產出，支援 PDF 下載。',
    screenTitle: '財務 / 報表中心',
    screen: (
      <div>
        <MockRow>
          <MockBtn primary>資產負債表</MockBtn>
          <MockBtn>損益表</MockBtn>
          <MockBtn>現金流量表</MockBtn>
        </MockRow>
        <MockCard title="損益表 — 2026 Q1">
          <MockTable headers={['科目', '金額']} rows={[['營業收入', '$9,650,000'], ['營業成本', '-$6,350,000'], ['營業毛利', '$3,300,000'], ['營業費用', '-$1,800,000'], ['營業淨利', '$1,500,000']]} />
        </MockCard>
      </div>
    ),
  },
  {
    title: '銀行對帳',
    desc: '匯入銀行明細，系統自動比對帳務紀錄，未沖帳項目一目瞭然。',
    screenTitle: '財務 / 銀行對帳',
    screen: (
      <div>
        <MockRow>
          <MockStat label="銀行餘額" value="$1,245,000" />
          <MockStat label="帳面餘額" value="$1,238,500" />
          <MockStat label="差異" value="$6,500" color="#d97706" />
        </MockRow>
        <MockTable headers={['日期', '摘要', '金額', '狀態']} rows={[
          ['04/05', '收款 — 好吃餐飲', '$45,000', <MockBadge color="#059669">已沖</MockBadge>],
          ['04/06', '轉帳 — 薪資', '-$380,000', <MockBadge color="#059669">已沖</MockBadge>],
          ['04/07', '收款 — 未知', '$6,500', <MockBadge color="#d97706">待確認</MockBadge>],
        ]} />
      </div>
    ),
  },
]

// ━━━━━━━━━━━━━━━━━━━━ 銷售管理 ━━━━━━━━━━━━━━━━━━━━
export const SALES_STEPS = [
  {
    title: '報價單版本管理',
    desc: '建立報價單支援版本控管（v1, v2...），客戶確認後一鍵轉為銷售訂單。',
    screenTitle: '銷售 / 報價管理',
    screen: (
      <div>
        <MockCard title="報價單 QT-2026-0089 v2">
          <MockRow>
            <MockField label="客戶" value="好吃餐飲" />
            <MockField label="狀態" value={<MockBadge color="#d97706">待確認</MockBadge>} />
          </MockRow>
          <MockTable headers={['品項', '數量', '單價', '小計']} rows={[['有機牛奶', '200', '$45', '$9,000'], ['全麥吐司', '100', '$35', '$3,500'], ['鮮奶油', '50', '$80', '$4,000']]} />
          <div style={{ marginTop: 8, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <MockBtn>編輯</MockBtn>
            <MockBtn primary>轉為訂單</MockBtn>
          </div>
        </MockCard>
      </div>
    ),
  },
  {
    title: '促銷引擎',
    desc: '設定滿額折、階梯折、VIP 價、組合優惠等規則，訂單成立時自動套用。',
    screenTitle: '銷售 / 促銷活動',
    screen: (
      <div>
        <MockCard title="進行中的促銷">
          <MockTable headers={['活動名稱', '類型', '折扣', '狀態']} rows={[
            ['春季大促', '滿額折', '滿 $5,000 折 $500', <MockBadge color="#059669">進行中</MockBadge>],
            ['VIP 專屬', 'VIP 價', '9 折', <MockBadge color="#059669">進行中</MockBadge>],
            ['買三送一', '組合優惠', '買 3 件送 1', <MockBadge color="#94a3b8">排程中</MockBadge>],
          ]} />
        </MockCard>
      </div>
    ),
  },
  {
    title: '銷售訂單與信用檢核',
    desc: '建立訂單時自動比對客戶信用額度，超過 80% 橘色警示、超過 100% 紅色阻擋。',
    screenTitle: '銷售 / 銷售訂單',
    screen: (
      <div>
        <MockCard title="訂單 #ORD-2026-1042">
          <MockRow>
            <MockField label="客戶" value="好吃餐飲" />
            <MockField label="信用額度" value="$500,000" />
          </MockRow>
          <MockRow>
            <MockField label="已用額度" value="$420,000 (84%)" />
            <MockField label="本單金額" value="$16,500" />
          </MockRow>
          <div style={{ marginTop: 8, padding: 8, borderRadius: 6, background: '#fef3c7', border: '1px solid #fcd34d', fontSize: 12, color: '#92400e' }}>
            信用額度使用率已達 87%，請注意應收帳款回收進度
          </div>
        </MockCard>
      </div>
    ),
  },
]

// ━━━━━━━━━━━━━━━━━━━━ POS 收銀 ━━━━━━━━━━━━━━━━━━━━
export const POS_STEPS = [
  {
    title: '收銀台結帳',
    desc: '搜尋商品加入購物車，支援現金、信用卡、行動支付等多元付款，結帳流程直覺快速。',
    screenTitle: 'POS / 收銀台',
    screen: (
      <div>
        <MockCard title="購物車">
          <MockTable headers={['商品', '數量', '金額']} rows={[['拿鐵 (L)', '2', '$180'], ['可頌', '1', '$65'], ['沙拉', '1', '$120']]} />
          <div style={{ borderTop: '1px solid #e2e8f0', marginTop: 8, paddingTop: 8, display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 14 }}>
            <span>合計</span>
            <span style={{ color: '#059669' }}>$365</span>
          </div>
          <MockRow>
            <MockBtn>現金</MockBtn>
            <MockBtn primary>信用卡</MockBtn>
            <MockBtn>LINE Pay</MockBtn>
          </MockRow>
        </MockCard>
      </div>
    ),
  },
  {
    title: '交班日結',
    desc: '班次結束後核對現金、刷卡金額，系統自動計算差異，溢缺一目瞭然。',
    screenTitle: 'POS / 交班日結',
    screen: (
      <div>
        <MockRow>
          <MockStat label="營業額" value="$28,450" color="#059669" />
          <MockStat label="交易筆數" value="67" color="#2563eb" />
        </MockRow>
        <MockCard title="現金核對">
          <MockTable headers={['項目', '系統', '實際', '差異']} rows={[
            ['現金', '$12,300', '$12,350', <MockBadge color="#059669">+$50</MockBadge>],
            ['信用卡', '$10,150', '$10,150', <MockBadge color="#059669">$0</MockBadge>],
            ['LINE Pay', '$6,000', '$6,000', <MockBadge color="#059669">$0</MockBadge>],
          ]} />
        </MockCard>
      </div>
    ),
  },
  {
    title: '營運總覽',
    desc: '即時查看當日營收、交易筆數、客單價趨勢，掌握門市營運狀況。',
    screenTitle: 'POS / 營運總覽',
    screen: (
      <div>
        <MockRow>
          <MockStat label="今日營收" value="$28,450" color="#059669" />
          <MockStat label="客單價" value="$425" color="#2563eb" />
          <MockStat label="來客數" value="67" />
        </MockRow>
        <MockCard title="時段分析">
          <MockTable headers={['時段', '營收', '筆數', '佔比']} rows={[
            ['11:00-14:00', '$12,800', '28', '45%'],
            ['17:00-20:00', '$9,200', '22', '32%'],
            ['其他時段', '$6,450', '17', '23%'],
          ]} />
        </MockCard>
      </div>
    ),
  },
]

// ━━━━━━━━━━━━━━━━━━━━ 採購管理 ━━━━━━━━━━━━━━━━━━━━
export const PURCHASE_STEPS = [
  {
    title: '供應商管理與評等',
    desc: '建立供應商檔案，記錄付款條件、交期表現、品質評分，定期自動更新評等。',
    screenTitle: '採購 / 供應商管理',
    screen: (
      <div>
        <MockTable headers={['供應商', '評等', '準時率', '合格率', '合作年數']} rows={[
          ['統一食品', <MockBadge color="#059669">A</MockBadge>, '96%', '99%', '5 年'],
          ['大成長城', <MockBadge color="#059669">A</MockBadge>, '92%', '97%', '3 年'],
          ['新東陽', <MockBadge color="#d97706">B</MockBadge>, '85%', '94%', '1 年'],
        ]} />
      </div>
    ),
  },
  {
    title: '採購申請與動態簽核',
    desc: '採購人員填寫需求，系統依金額和類別自動路由到對應主管審核。',
    screenTitle: '採購 / 採購申請',
    screen: (
      <div>
        <MockCard title="採購申請 #PR-2026-0198">
          <MockRow>
            <MockField label="申請人" value="張大偉" />
            <MockField label="金額" value="$85,000" />
          </MockRow>
          <MockTable headers={['品項', '數量', '預估單價']} rows={[['有機牛奶', '500', '$45'], ['鮮奶油', '200', '$80'], ['雞胸肉', '300', '$65']]} />
          <div style={{ marginTop: 8, fontSize: 11, color: '#64748b' }}>
            簽核流程：採購主管 → 財務主管（金額 ≥ $50,000）
          </div>
        </MockCard>
      </div>
    ),
  },
  {
    title: '三方比對（PO / GR / Invoice）',
    desc: '採購單、進貨驗收單、供應商發票三方自動比對，差異即時標示。',
    screenTitle: '採購 / 三方比對',
    screen: (
      <div>
        <MockCard title="比對結果 — PO-2026-0410">
          <MockTable headers={['品項', '採購單', '驗收單', '發票', '狀態']} rows={[
            ['有機牛奶', '100', '100', '100', <MockBadge color="#059669">一致</MockBadge>],
            ['鮮奶油', '50', '48', '50', <MockBadge color="#ef4444">差異</MockBadge>],
            ['雞胸肉', '80', '80', '80', <MockBadge color="#059669">一致</MockBadge>],
          ]} />
          <div style={{ marginTop: 8, padding: 8, borderRadius: 6, background: '#fef2f2', border: '1px solid #fecaca', fontSize: 12, color: '#991b1b' }}>
            鮮奶油：驗收數量 48 與採購單 50 不符，請確認短少原因
          </div>
        </MockCard>
      </div>
    ),
  },
]

// ━━━━━━━━━━━━━━━━━━━━ 生產品管 ━━━━━━━━━━━━━━━━━━━━
export const MFG_STEPS = [
  {
    title: 'BOM 物料清單',
    desc: '建立成品的零件組成，支援多階 BOM 展開，一鍵計算所需原料數量。',
    screenTitle: '製造 / BOM 物料清單',
    screen: (
      <div>
        <MockCard title="BOM — 經典可頌（成品）">
          <MockTable headers={['原料', '單位用量', '庫存', '狀態']} rows={[
            ['高筋麵粉', '0.3 kg', '500 kg', <MockBadge color="#059669">充足</MockBadge>],
            ['奶油', '0.15 kg', '20 kg', <MockBadge color="#d97706">偏低</MockBadge>],
            ['酵母', '0.005 kg', '8 kg', <MockBadge color="#059669">充足</MockBadge>],
            ['鹽', '0.003 kg', '15 kg', <MockBadge color="#059669">充足</MockBadge>],
          ]} />
        </MockCard>
      </div>
    ),
  },
  {
    title: 'MRP 需求計畫',
    desc: '根據訂單需求和現有庫存，自動計算各原料的缺料數量與建議採購時程。',
    screenTitle: '製造 / MRP 需求計畫',
    screen: (
      <div>
        <MockCard title="MRP 執行結果 — 本週需求">
          <MockTable headers={['原料', '需求量', '庫存', '缺口', '建議']} rows={[
            ['高筋麵粉', '150 kg', '500 kg', '—', <MockBadge color="#059669">無需採購</MockBadge>],
            ['奶油', '75 kg', '20 kg', '55 kg', <MockBadge color="#ef4444">建議採購</MockBadge>],
            ['雞胸肉', '200 kg', '150 kg', '50 kg', <MockBadge color="#ef4444">建議採購</MockBadge>],
          ]} />
          <div style={{ marginTop: 8 }}><MockBtn primary>一鍵產生採購建議單</MockBtn></div>
        </MockCard>
      </div>
    ),
  },
  {
    title: '品質檢驗',
    desc: '進料檢驗、製程檢驗、成品檢驗完整記錄，不合格品自動攔截。',
    screenTitle: '製造 / 品質管理',
    screen: (
      <div>
        <MockRow>
          <MockStat label="本月檢驗" value="286" />
          <MockStat label="合格率" value="97.2%" color="#059669" />
          <MockStat label="不合格" value="8" color="#ef4444" />
        </MockRow>
        <MockTable headers={['批號', '品項', '檢驗類型', '結果']} rows={[
          ['L-20260407-01', '經典可頌', '成品檢驗', <MockBadge color="#059669">合格</MockBadge>],
          ['L-20260407-02', '鮮奶吐司', '成品檢驗', <MockBadge color="#059669">合格</MockBadge>],
          ['M-20260406-05', '奶油（進料）', '進料檢驗', <MockBadge color="#ef4444">不合格</MockBadge>],
        ]} />
      </div>
    ),
  },
]

// ━━━━━━━━━━━━━━━━━━━━ 組織管理 ━━━━━━━━━━━━━━━━━━━━
export const ORG_STEPS = [
  {
    title: '多公司與門市管理',
    desc: '管理多間公司和門市據點，每個據點設定 GPS 打卡座標和 WiFi IP 白名單。',
    screenTitle: '組織 / 門市管理',
    screen: (
      <div>
        <MockTable headers={['門市', '地區', '員工數', 'GPS 狀態']} rows={[
          ['台北信義店', '台北市', '12', <MockBadge color="#059669">已設定</MockBadge>],
          ['台中逢甲店', '台中市', '8', <MockBadge color="#059669">已設定</MockBadge>],
          ['高雄巨蛋店', '高雄市', '10', <MockBadge color="#d97706">待設定</MockBadge>],
        ]} />
      </div>
    ),
  },
  {
    title: '部門與組織架構',
    desc: '視覺化組織圖，部門間上下級關係清楚，支援跨部門調動紀錄。',
    screenTitle: '組織 / 組織圖',
    screen: (
      <div>
        <MockCard title="組織架構">
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 2 }}>
            <div style={{ fontWeight: 700 }}>董事長 — 王大明</div>
            <div style={{ paddingLeft: 16 }}>├ 營運部（8 人）— 李經理</div>
            <div style={{ paddingLeft: 16 }}>├ 業務部（12 人）— 陳經理</div>
            <div style={{ paddingLeft: 16 }}>├ 財務部（4 人）— 張經理</div>
            <div style={{ paddingLeft: 16 }}>├ 研發部（6 人）— 林經理</div>
            <div style={{ paddingLeft: 16 }}>└ 人資部（3 人）— 周經理</div>
          </div>
        </MockCard>
      </div>
    ),
  },
  {
    title: 'LINE 官方帳號串接',
    desc: '綁定 LINE 官方帳號，員工透過 LINE 完成打卡、請假等操作，推播通知即時送達。',
    screenTitle: '組織 / LINE 串接',
    screen: (
      <div>
        <MockRow>
          <MockStat label="已綁定員工" value="28/30" color="#059669" />
          <MockStat label="今日推播" value="45" color="#2563eb" />
        </MockRow>
        <MockCard title="推播紀錄">
          <MockTable headers={['時間', '類型', '對象', '狀態']} rows={[
            ['08:55', '打卡提醒', '全體', <MockBadge color="#059669">已送達</MockBadge>],
            ['09:30', '假單通知', '李經理', <MockBadge color="#059669">已讀</MockBadge>],
            ['14:00', '庫存警示', '張大偉', <MockBadge color="#d97706">未讀</MockBadge>],
          ]} />
        </MockCard>
      </div>
    ),
  },
]

// ━━━━━━━━━━━━━━━━━━━━ 數據分析 ━━━━━━━━━━━━━━━━━━━━
export const ANALYTICS_STEPS = [
  {
    title: 'BI 營運看板',
    desc: '即時營運數據圖表化呈現，營收趨勢、庫存狀態、人力配置一目瞭然。',
    screenTitle: '分析 / BI 看板',
    screen: (
      <div>
        <MockRow>
          <MockStat label="月營收" value="$3.2M" color="#059669" />
          <MockStat label="毛利率" value="34%" color="#2563eb" />
          <MockStat label="出勤率" value="96%" color="#7c3aed" />
        </MockRow>
        <MockCard title="營收趨勢（近 6 月）">
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 80 }}>
            {[55, 62, 58, 71, 68, 78].map((h, i) => (
              <div key={i} style={{ flex: 1, background: i === 5 ? '#2563eb' : '#2563eb30', borderRadius: 3, height: `${h}%` }} />
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#94a3b8', marginTop: 4 }}>
            <span>11月</span><span>12月</span><span>1月</span><span>2月</span><span>3月</span><span>4月</span>
          </div>
        </MockCard>
      </div>
    ),
  },
  {
    title: '異常偵測',
    desc: 'AI 自動掃描營運數據，標記異常值（如突然的成本飆升、庫存異常消耗）。',
    screenTitle: '分析 / 異常偵測',
    screen: (
      <div>
        <MockTable headers={['偵測時間', '類型', '描述', '嚴重度']} rows={[
          ['04/06', '成本異常', '鮮奶油單價較上月上漲 23%', <MockBadge color="#ef4444">高</MockBadge>],
          ['04/05', '庫存異常', 'A001 有機牛奶消耗速度異常加快', <MockBadge color="#d97706">中</MockBadge>],
          ['04/03', '出勤異常', '台中店連續 3 天遲到人數偏高', <MockBadge color="#d97706">中</MockBadge>],
        ]} />
      </div>
    ),
  },
  {
    title: '自訂儀表板',
    desc: '拖拉式配置個人化看板，選擇關心的指標和圖表類型，儲存後每次登入自動載入。',
    screenTitle: '分析 / 自訂儀表板',
    screen: (
      <div>
        <MockCard title="我的看板 — 老闆日報">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <MockStat label="今日營收" value="$98K" color="#059669" />
            <MockStat label="待收帳款" value="$890K" color="#d97706" />
            <MockStat label="低庫存品" value="12" color="#ef4444" />
            <MockStat label="待審假單" value="3" color="#2563eb" />
          </div>
        </MockCard>
        <div style={{ marginTop: 8, fontSize: 11, color: '#94a3b8', textAlign: 'center' }}>
          拖拉即可調整配置 · 支援匯出 PDF · 可排程 Email 寄送
        </div>
      </div>
    ),
  },
]

// ━━━━━━━━━━━━━━━━━━━━ 系統管理 ━━━━━━━━━━━━━━━━━━━━
export const SYSTEM_STEPS = [
  {
    title: 'RBAC 角色權限',
    desc: '依角色設定功能存取權限，確保每位使用者只能看到和操作被授權的範圍。',
    screenTitle: '系統 / 權限管理',
    screen: (
      <div>
        <MockTable headers={['角色', '人數', '權限範圍']} rows={[
          ['系統管理員', '2', '所有功能'],
          ['門市主管', '5', 'HR + POS + 庫存（僅所屬門市）'],
          ['一般員工', '23', '個人出勤 + 請假 + 任務'],
          ['財務人員', '3', '財務全模組 + 報表'],
        ]} />
      </div>
    ),
  },
  {
    title: '操作紀錄追蹤',
    desc: '所有使用者操作留下完整稽核軌跡，欄位級變更紀錄，支援時間範圍查詢。',
    screenTitle: '系統 / 操作紀錄',
    screen: (
      <div>
        <MockTable headers={['時間', '使用者', '操作', '變更']} rows={[
          ['16:32', '王小明', '修改客戶資料', '電話 0912→0933'],
          ['15:10', '李美玲', '新增採購單', 'PO-2026-0415'],
          ['14:45', '張大偉', '核准假單', 'LV-2026-089 → 已核准'],
          ['13:20', '系統', '自動拋帳', 'AR-2026-0857 已建立'],
        ]} />
      </div>
    ),
  },
  {
    title: '自動觸發器',
    desc: '設定事件驅動或排程觸發的自動化規則，如庫存低於安全量時自動通知採購。',
    screenTitle: '系統 / 觸發器',
    screen: (
      <div>
        <MockTable headers={['觸發器', '條件', '動作', '狀態']} rows={[
          ['低庫存通知', '庫存 ≤ 安全量', 'LINE 通知採購人員', <MockBadge color="#059669">啟用</MockBadge>],
          ['逾期帳款提醒', '超過 60 天未收', 'Email 通知業務', <MockBadge color="#059669">啟用</MockBadge>],
          ['排班檢核', '每日 00:00', '檢查次週排班合規', <MockBadge color="#059669">啟用</MockBadge>],
          ['月結報表', '每月 1 日', '產生上月損益表', <MockBadge color="#94a3b8">停用</MockBadge>],
        ]} />
      </div>
    ),
  },
]

/** All demos bundled */
export const ALL_DEMOS = [
  { key: 'hr', label: '人事管理', icon: Users, color: '#2563eb', steps: HR_STEPS },
  { key: 'crm', label: '客戶經營', icon: HeadphonesIcon, color: '#f97316', steps: CRM_STEPS },
  { key: 'wms', label: '倉儲物流', icon: Warehouse, color: '#059669', steps: WMS_STEPS },
  { key: 'finance', label: '財務會計', icon: CreditCard, color: '#d97706', steps: FINANCE_STEPS },
  { key: 'sales', label: '銷售管理', icon: ShoppingCart, color: '#db2777', steps: SALES_STEPS },
  { key: 'pos', label: 'POS 收銀', icon: Monitor, color: '#06b6d4', steps: POS_STEPS },
  { key: 'purchase', label: '採購管理', icon: ShoppingCart, color: '#d97706', steps: PURCHASE_STEPS },
  { key: 'mfg', label: '生產品管', icon: Factory, color: '#f97316', steps: MFG_STEPS },
  { key: 'org', label: '組織管理', icon: Building2, color: '#7c3aed', steps: ORG_STEPS },
  { key: 'analytics', label: '數據分析', icon: PieChart, color: '#2563eb', steps: ANALYTICS_STEPS },
  { key: 'system', label: '系統管理', icon: Shield, color: '#ef4444', steps: SYSTEM_STEPS },
]
