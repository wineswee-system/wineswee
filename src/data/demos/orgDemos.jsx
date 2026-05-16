import { MockTable, MockStat, MockBadge, MockCard, MockRow } from '../../components/ui/FeatureCarousel'

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
