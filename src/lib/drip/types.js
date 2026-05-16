// ── 觸發類型定義 ──
export const TRIGGER_TYPES = [
  {
    id: 'new_customer',
    name: '新客戶加入',
    nameEn: 'New Customer',
    description: '當新客戶完成註冊或首次加入會員時觸發',
    icon: '👤',
  },
  {
    id: 'abandoned_cart',
    name: '購物車放棄',
    nameEn: 'Abandoned Cart',
    description: '客戶將商品加入購物車但未完成結帳時觸發',
    icon: '🛒',
  },
  {
    id: 'post_purchase',
    name: '購買完成',
    nameEn: 'Post Purchase',
    description: '客戶完成訂單付款後觸發',
    icon: '✅',
  },
  {
    id: 'inactivity',
    name: '客戶沉睡',
    nameEn: 'Inactivity',
    description: '客戶超過指定天數未有任何互動時觸發',
    icon: '💤',
  },
  {
    id: 'birthday',
    name: '生日',
    nameEn: 'Birthday',
    description: '會員生日前指定天數自動觸發',
    icon: '🎂',
  },
  {
    id: 'subscription',
    name: '訂閱啟用',
    nameEn: 'Subscription',
    description: '客戶訂閱方案啟用或續約時觸發',
    icon: '📦',
  },
  {
    id: 'manual',
    name: '手動觸發',
    nameEn: 'Manual',
    description: '由行銷人員手動選擇名單並觸發',
    icon: '✋',
  },
]

// ── 步驟類型定義 ──
export const STEP_TYPES = [
  {
    id: 'email',
    name: '電子郵件',
    nameEn: 'Email',
    description: '發送電子郵件給目標聯絡人',
    fields: ['subject', 'content', 'template_id'],
  },
  {
    id: 'line',
    name: 'LINE 訊息',
    nameEn: 'LINE Message',
    description: '透過 LINE 官方帳號推送訊息',
    fields: ['content', 'template_id'],
  },
  {
    id: 'sms',
    name: '簡訊',
    nameEn: 'SMS',
    description: '發送手機簡訊',
    fields: ['content'],
  },
  {
    id: 'wait',
    name: '等待',
    nameEn: 'Wait',
    description: '等待指定時間後再執行下一步',
    fields: ['delay_days', 'delay_hours'],
  },
  {
    id: 'condition',
    name: '條件分支',
    nameEn: 'Condition',
    description: '根據條件判斷走不同分支流程',
    fields: ['field', 'operator', 'value', 'true_branch_step', 'false_branch_step'],
  },
]
