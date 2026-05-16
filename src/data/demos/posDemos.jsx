import { MockTable, MockStat, MockBadge, MockBtn, MockCard, MockRow } from '../../components/ui/FeatureCarousel'

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
