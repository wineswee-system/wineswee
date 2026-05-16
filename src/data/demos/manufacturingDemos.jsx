import { MockTable, MockStat, MockBadge, MockBtn, MockCard, MockRow } from '../../components/ui/FeatureCarousel'

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
