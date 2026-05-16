import { MockTable, MockStat, MockBadge, MockBtn, MockCard, MockRow } from '../../components/ui/FeatureCarousel'
import { Check } from 'lucide-react'

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
            <MockStat label="日期" value="2026/04/07" />
            <MockStat label="來源" value={<MockBadge color="#2563eb">自動 — 出貨</MockBadge>} />
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
