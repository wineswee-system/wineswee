/**
 * AI 輔助 Email / 行銷模板產生引擎
 *
 * 純前端規則式智慧引擎 — 不呼叫外部 AI API。
 * 透過豐富的預寫內容區塊庫，依據情境（目的、語氣、產業）
 * 自動組合出完整的行銷 Email 模板、主旨行、CTA 等。
 *
 * 所有函式皆為純函式，完全於客戶端執行。
 */

// ═══════════════════════════════════════════════════════════
// 垃圾郵件觸發詞庫（中英文）
// ═══════════════════════════════════════════════════════════
export const SPAM_TRIGGER_WORDS = [
  // 英文常見 spam 觸發詞
  'free', 'act now', 'limited time', 'click here', 'buy now',
  'no obligation', 'winner', 'congratulations', 'cash bonus',
  'earn money', 'double your', 'risk-free', 'no cost', 'guaranteed',
  'apply now', 'order now', 'urgent', '100% free', 'lowest price',
  'best price', 'incredible deal', 'special promotion', 'one time offer',
  'while supplies last', 'you have been selected', 'dear friend',
  'make money', 'extra income', 'no strings attached',
  // 中文常見 spam 觸發詞
  '免費', '中獎', '恭喜您', '點擊這裡', '馬上行動',
  '限時搶購', '不買可惜', '暴利', '穩賺不賠', '零風險',
  '最低價', '最後機會', '錯過不再', '獨家秘密', '日賺萬元',
  '輕鬆月入', '一夜致富', '不看後悔', '現金回饋', '被選中',
  '加我好友', '驚爆價', '跳樓大拍賣', '血本出清', '瘋狂特價',
  '史上最低', '保證獲利', '無條件退款', '賺翻了', '密技公開',
]

// ═══════════════════════════════════════════════════════════
// Email 設計預設集
// ═══════════════════════════════════════════════════════════
export const EMAIL_DESIGN_PRESETS = {
  minimal: {
    name: 'minimal',
    nameZh: '極簡風格',
    primaryColor: '#111827',
    bgColor: '#ffffff',
    textColor: '#374151',
    fontFamily: "'Noto Sans TC', 'Helvetica Neue', Arial, sans-serif",
    headerStyle: 'text-align:center; padding:40px 20px; border-bottom:1px solid #e5e7eb;',
    buttonStyle: 'background:#111827; color:#fff; padding:12px 32px; border-radius:4px; text-decoration:none; font-size:14px; display:inline-block;',
    layoutDescription: '大量留白、單欄式排版、無背景色、細線分隔',
  },
  modern: {
    name: 'modern',
    nameZh: '現代風格',
    primaryColor: '#6366f1',
    bgColor: '#f8fafc',
    textColor: '#334155',
    fontFamily: "'Noto Sans TC', 'Inter', system-ui, sans-serif",
    headerStyle: 'background:linear-gradient(135deg,#6366f1,#8b5cf6); color:#fff; padding:48px 24px; text-align:center; border-radius:0 0 24px 24px;',
    buttonStyle: 'background:linear-gradient(135deg,#6366f1,#8b5cf6); color:#fff; padding:14px 36px; border-radius:12px; text-decoration:none; font-size:15px; display:inline-block; box-shadow:0 4px 14px rgba(99,102,241,0.4);',
    layoutDescription: '漸層標頭、卡片式排版、圓角元素、微陰影',
  },
  classic: {
    name: 'classic',
    nameZh: '經典商務',
    primaryColor: '#1e40af',
    bgColor: '#f9fafb',
    textColor: '#1f2937',
    fontFamily: "'Noto Serif TC', Georgia, 'Times New Roman', serif",
    headerStyle: 'background:#1e40af; color:#fff; padding:32px 24px; text-align:left;',
    buttonStyle: 'background:#1e40af; color:#fff; padding:12px 28px; border-radius:2px; text-decoration:none; font-size:14px; display:inline-block; text-transform:uppercase; letter-spacing:1px;',
    layoutDescription: '傳統商務信件風格、對齊左邊、襯線字型、穩重配色',
  },
  bold: {
    name: 'bold',
    nameZh: '大膽醒目',
    primaryColor: '#dc2626',
    bgColor: '#fef2f2',
    textColor: '#171717',
    fontFamily: "'Noto Sans TC', 'Montserrat', Impact, sans-serif",
    headerStyle: 'background:#dc2626; color:#fff; padding:56px 24px; text-align:center; font-size:28px; font-weight:900;',
    buttonStyle: 'background:#dc2626; color:#fff; padding:16px 40px; border-radius:50px; text-decoration:none; font-size:18px; font-weight:700; display:inline-block; text-transform:uppercase;',
    layoutDescription: '大字排版、鮮豔配色、粗體按鈕、視覺衝擊強',
  },
  elegant: {
    name: 'elegant',
    nameZh: '高級質感',
    primaryColor: '#d4af37',
    bgColor: '#1a1a2e',
    textColor: '#e2e8f0',
    fontFamily: "'Noto Serif TC', 'Playfair Display', Georgia, serif",
    headerStyle: 'background:#1a1a2e; color:#d4af37; padding:48px 24px; text-align:center; border-bottom:2px solid #d4af37; letter-spacing:4px;',
    buttonStyle: 'background:transparent; color:#d4af37; padding:14px 36px; border:2px solid #d4af37; border-radius:0; text-decoration:none; font-size:14px; display:inline-block; letter-spacing:2px; text-transform:uppercase;',
    layoutDescription: '深色底、金色裝飾、襯線字型、奢華氛圍',
  },
}

// ═══════════════════════════════════════════════════════════
// AI 內容區塊庫（依目的 × 語氣分類）
// ═══════════════════════════════════════════════════════════
export const AI_CONTENT_BLOCKS = {
  // ── 問候語 ──
  greetings: {
    professional: [
      '親愛的 {{customer_name}} 您好，',
      '{{customer_name}} 先生/女士 您好，',
      '尊敬的 {{customer_name}}，',
      '{{customer_name}} 您好，感謝您的支持，',
      '敬愛的 {{customer_name}}，',
    ],
    friendly: [
      '嗨 {{customer_name}}！',
      'Hey {{customer_name}} 👋',
      '{{customer_name}} 你好呀～',
      'Hello {{customer_name}}！好久不見 😊',
      '哈囉 {{customer_name}}！',
    ],
    urgent: [
      '{{customer_name}}，這封信很重要 ⚡',
      '{{customer_name}} 您好 — 請留意以下訊息：',
      '親愛的 {{customer_name}}，請立即查看：',
      '{{customer_name}}，緊急通知！',
      '{{customer_name}} 您好，有重要資訊需要您關注：',
    ],
    luxurious: [
      '尊貴的 {{customer_name}}，',
      '{{customer_name}} 閣下，',
      '至尊會員 {{customer_name}} 您好，',
      '親愛的貴賓 {{customer_name}}，',
      '尊榮客戶 {{customer_name}} 您好，',
    ],
    playful: [
      '{{customer_name}}～猜猜看！🎉',
      'Yo {{customer_name}}！✨',
      '{{customer_name}} 寶～',
      '嘿嘿 {{customer_name}}！有好事要跟你說 🎊',
      '{{customer_name}} 朋友你好！🌟',
    ],
  },

  // ── 開場白（依目的分類）──
  openings: {
    welcome: [
      '感謝您加入 {{company_name}} 的大家庭！我們非常期待與您展開這段旅程。',
      '歡迎成為 {{company_name}} 的一員！您的帳號已經準備就緒。',
      '很高興認識您！感謝您選擇 {{company_name}}，以下是幾個快速入門的小提示。',
      '{{company_name}} 全體團隊歡迎您！讓我們帶您快速了解如何開始。',
      '恭喜您完成註冊！歡迎來到 {{company_name}}，讓我們一起探索更多可能。',
    ],
    promotion: [
      '限時優惠來了！我們為您準備了一份專屬好禮。',
      '好消息！{{product_name}} 正在進行超值促銷活動。',
      '{{customer_name}}，您專屬的折扣碼已經準備好了！',
      '歡慶週年！{{company_name}} 感謝有您，送上最實在的回饋。',
      '我們注意到您對 {{product_name}} 很感興趣——現在正是最佳入手時機！',
    ],
    newsletter: [
      '以下是本週 {{company_name}} 的精選內容，希望對您有幫助。',
      '{{company_name}} 月報來囉！讓我們一起回顧本月亮點。',
      '本期電子報為您整理了產業趨勢與實用資訊。',
      '感謝您持續關注 {{company_name}}！以下是我們精心準備的內容。',
      '又到了分享的時刻！這次我們帶來了幾個值得關注的話題。',
    ],
    announcement: [
      '{{company_name}} 有重大消息要與您分享！',
      '我們很興奮地宣布一項全新的更新。',
      '致所有 {{company_name}} 的夥伴——以下是一項重要公告。',
      '經過數月的籌備，我們終於可以正式發表這個好消息。',
      '{{company_name}} 即將迎來重要的里程碑，想第一時間與您分享。',
    ],
    follow_up: [
      '上次與您聯繫後，想確認您是否有任何疑問需要我們協助。',
      '謝謝您上次撥空了解 {{product_name}}，想跟您分享更多細節。',
      '距離您上次訪問已有一段時間，我們有些新的內容想與您分享。',
      '希望您一切順利！想快速跟進上次我們討論的事項。',
      '{{customer_name}}，還記得我們嗎？有些更新想讓您知道。',
    ],
    thank_you: [
      '衷心感謝您的購買！您的訂單已確認。',
      '謝謝您選擇 {{company_name}}！您的支持是我們最大的動力。',
      '感謝您的信任與支持！以下是您的訂單明細。',
      '太棒了！您的訂單已經成功處理，感謝您的支持。',
      '{{customer_name}}，由衷感謝您！有您真好。',
    ],
    feedback: [
      '您的意見對我們非常重要！希望花您 2 分鐘時間分享使用心得。',
      '我們一直在努力進步，想聽聽您對 {{product_name}} 的看法。',
      '{{customer_name}}，使用 {{product_name}} 還順利嗎？歡迎告訴我們您的想法。',
      '為了提供更好的服務，我們誠摯地邀請您填寫這份簡短問卷。',
      '您的回饋是我們進步的原動力！請花一點時間給我們一些建議。',
    ],
    reactivation: [
      '好久不見！我們想念您了。',
      '{{customer_name}}，距離您上次光顧已經有一陣子了，特別為您準備了回歸禮。',
      '嗨！最近過得好嗎？{{company_name}} 有了很多新變化，想邀您回來看看。',
      '我們發現您已經有一段時間沒來了——有什麼我們可以改進的地方嗎？',
      '{{customer_name}}，我們很想念您！這裡有份專屬優惠等著您回來。',
    ],
    event_invitation: [
      '{{company_name}} 誠摯邀請您參加一場精彩活動！',
      '您被邀請了！我們即將舉辦一場不容錯過的活動。',
      '重要活動通知：請預留時間，我們有一場特別的活動想邀您參加。',
      '{{customer_name}}，這場活動是為您量身打造的，千萬別錯過！',
      '名額有限！趕快報名參加 {{company_name}} 即將舉辦的獨家活動。',
    ],
    product_launch: [
      '重磅登場！{{product_name}} 正式上市！',
      '等待已久的 {{product_name}} 終於來了！搶先體驗全新功能。',
      '全新 {{product_name}} 震撼發表——為您帶來前所未有的體驗。',
      '{{company_name}} 自豪地推出最新力作：{{product_name}}。',
      '{{product_name}} 今天正式發售！作為我們的 VIP，您享有搶先購買權。',
    ],
  },

  // ── 正文段落（依目的分類）──
  bodies: {
    welcome: [
      '在開始之前，以下是幾個實用小技巧：\n1. 完善您的個人資料\n2. 瀏覽我們的熱門商品\n3. 訂閱電子報掌握最新優惠',
      '為了讓您有最好的體驗，我們準備了新手指南。從帳號設定到首次購物，每一步都有詳細說明。',
      '作為新會員，您已獲得專屬的歡迎禮遇：\n• 首購 9 折優惠\n• 免費配送一次\n• 專屬客服通道',
    ],
    promotion: [
      '即日起至 {{end_date}}，全站商品享有最高 {{discount}} 的優惠折扣。使用折扣碼 {{promo_code}} 即可享受這波限時特惠！',
      '本次活動精選熱門商品：\n• {{product_name}} — 原價 {{original_price}}，特價 {{sale_price}}\n• 滿額再享免運\n• 加購配件 8 折起',
      '這是我們今年最大幅度的優惠活動，機會難得。庫存有限，售完為止！',
    ],
    newsletter: [
      '📌 本期精選：\n\n1. 產業趨勢分析\n2. 實用操作教學\n3. 客戶成功案例\n4. 近期活動預告',
      '本月焦點：我們的團隊深入研究了最新的市場動態，為您整理出最關鍵的洞察。以下內容將幫助您在業務上做出更明智的決策。',
      '您可能錯過了：上個月最受歡迎的三篇文章，現在還來得及閱讀！',
    ],
    announcement: [
      '經過團隊數月的努力，我們很高興地宣布這項全新功能已正式上線。這將大幅提升您的使用體驗。',
      '重要變更通知：自 {{effective_date}} 起，我們將進行以下調整，請詳閱以確保權益不受影響。',
      '為了提供更好的服務品質，我們進行了全面升級。以下是本次更新的重點內容。',
    ],
    follow_up: [
      '上次您表示對 {{product_name}} 有興趣，我們最近又推出了幾項新功能，相信會更符合您的需求。',
      '不確定是否適合？我們提供免費試用 / 線上 Demo，讓您親身體驗。',
      '如果您有任何問題，隨時可以回覆此信件或撥打我們的客服專線，我們很樂意為您服務。',
    ],
    thank_you: [
      '您的訂單編號為 {{order_id}}，預計 {{delivery_date}} 送達。您可以隨時在會員中心追蹤訂單狀態。',
      '我們已開始為您的訂單進行備貨。如有任何問題，請隨時與我們聯繫。',
      '感謝您的支持！為表謝意，下次購物可享專屬回饋優惠。',
    ],
    feedback: [
      '只需要花 2-3 分鐘填寫以下問卷，您的每一個回饋都會被認真看待。作為感謝，完成問卷後可獲得 {{reward}} 。',
      '我們特別想了解：\n• 整體滿意度如何？\n• 有什麼地方可以改進？\n• 您會推薦給朋友嗎？',
      '您的聲音很重要！我們的產品團隊會定期審閱所有回饋，並納入未來改善計畫中。',
    ],
    reactivation: [
      '自從您上次來訪後，我們有了不少新變化：\n• 全新產品上線\n• 操作介面大改版\n• 更快的出貨速度\n歡迎回來看看！',
      '我們理解每個人都很忙碌。為了歡迎您回來，這裡有一份專屬優惠碼 {{promo_code}}，限時使用。',
      '有任何我們可以改善的地方嗎？您的離開讓我們反思，也做了許多調整。真心希望能再次為您服務。',
    ],
    event_invitation: [
      '📅 活動詳情：\n• 日期：{{event_date}}\n• 時間：{{event_time}}\n• 地點：{{event_location}}\n• 講者：{{speaker_name}}\n\n名額有限，請儘早報名。',
      '本次活動您將學到：\n1. 產業最新趨勢\n2. 實戰案例分享\n3. 與業界專家面對面交流\n4. 獨家資源與工具',
      '參加者將獲得：\n• 精美活動手冊\n• 茶點招待\n• 會後簡報檔案\n• 專屬社群加入資格',
    ],
    product_launch: [
      '{{product_name}} 的核心亮點：\n✅ 功能一：更快、更穩定\n✅ 功能二：全新介面設計\n✅ 功能三：與現有系統無縫整合\n✅ 功能四：強大的數據分析能力',
      '為什麼選擇 {{product_name}}？因為我們從您的回饋出發，解決了最常被提及的痛點。這不只是升級，而是全新的體驗。',
      '早鳥優惠：上市首週購買享 {{discount}} 折優惠，再送 {{bonus}} 好禮。數量有限，手刀搶購！',
    ],
  },

  // ── 結尾語 ──
  closings: {
    professional: [
      '如有任何疑問，歡迎隨時與我們聯繫。',
      '期待與您的進一步合作。',
      '謝謝您的寶貴時間，祝您一切順利。',
      '敬祝 商祺',
      '誠摯感謝您的支持，祝事業蒸蒸日上。',
    ],
    friendly: [
      '有問題隨時找我們聊聊！😊',
      '祝您有美好的一天！',
      '我們隨時在這裡，需要就說一聲！',
      '期待下次見面～',
      '保持聯繫唷！❤️',
    ],
    urgent: [
      '請在期限內完成操作，以免錯失權益。',
      '時間有限，請立即行動！',
      '倒數計時已開始，把握最後機會！',
      '逾期恕不受理，請務必留意截止日。',
      '機不可失，時不再來！',
    ],
    luxurious: [
      '期待為您提供更臻完美的服務體驗。',
      '我們的專屬顧問隨時為您效勞。',
      '願這份心意為您的生活增添一抹質感。',
      '您的滿意，是我們最高的追求。',
      '靜候佳音，祝您品味生活每一刻。',
    ],
    playful: [
      '記得回來找我們玩～🎮',
      '下次見囉！掰掰 👋',
      '就醬！祝你開心每一天 🌈',
      '好啦不打擾你了，有空常來！🚀',
      '比個心心 ❤️ 掰！',
    ],
  },

  // ── CTA 按鈕文字（依目的分類）──
  ctas: {
    welcome: ['開始探索', '前往會員中心', '領取歡迎禮', '完善個人資料', '瀏覽熱門商品'],
    promotion: ['立即搶購', '領取折扣碼', '查看優惠', '馬上下單', '前往活動頁'],
    newsletter: ['閱讀完整文章', '了解更多', '查看本期內容', '前往部落格', '深入了解'],
    announcement: ['查看詳情', '了解更多', '前往查看', '立即體驗', '閱讀完整公告'],
    follow_up: ['預約 Demo', '了解更多', '回覆此信', '聯繫我們', '免費試用'],
    thank_you: ['追蹤訂單', '查看訂單', '繼續購物', '前往會員中心', '推薦好友'],
    feedback: ['填寫問卷', '分享您的想法', '開始填寫', '立即回饋', '前往評分'],
    reactivation: ['歡迎回來', '領取回歸禮', '重新探索', '查看最新商品', '使用優惠碼'],
    event_invitation: ['立即報名', '我要參加', '預約席位', '免費報名', '查看活動詳情'],
    product_launch: ['搶先體驗', '立即購買', '了解更多', '預購 {{product_name}}', '觀看介紹影片'],
  },

  // ── 社會證明語句 ──
  social_proof: [
    '已有 {{count}} 位客戶選擇了我們',
    '超過 {{count}} 家企業信賴 {{company_name}}',
    '客戶滿意度高達 {{percentage}}%',
    '累計服務超過 {{count}} 位客戶',
    '在 {{platform}} 上獲得 {{rating}} 星好評',
    '「{{testimonial}}」— {{reviewer_name}}，{{reviewer_company}}',
    '{{count}} 位用戶推薦此產品',
    '{{industry}} 領域 No.1 首選品牌',
    '連續 {{years}} 年榮獲最佳服務獎',
    '上線至今零負評，100% 好評推薦',
  ],

  // ── 緊迫感語句 ──
  urgency: [
    '限時 48 小時',
    '僅剩 {{count}} 件',
    '優惠倒數 {{hours}} 小時',
    '今日限定',
    '本週末截止',
    '名額只剩 {{count}} 位',
    '活動即將結束',
    '最後 {{count}} 組',
    '搶購中，售完為止',
    '限量 {{count}} 份，先搶先贏',
  ],

  // ── 頁尾（依風格分類）──
  footers: {
    professional: [
      '{{company_name}}\n{{company_address}}\n客服專線：{{phone}} | Email：{{email}}\n© {{year}} {{company_name}} 版權所有',
      '{{company_name}} | 統一編號：{{tax_id}}\n如不想再收到此信件，請點擊取消訂閱\n© {{year}} {{company_name}}',
      '此信件由 {{company_name}} 系統自動發送\n客服時間：週一至週五 09:00–18:00\n© {{year}} {{company_name}} All Rights Reserved.',
    ],
    friendly: [
      '❤️ 來自 {{company_name}} 團隊\n有問題嗎？直接回覆這封信就好！\n不想收到？取消訂閱',
      '{{company_name}} 用心為您服務 ✨\n追蹤我們：FB | IG | LINE\n取消訂閱 | 更新偏好',
      '感謝閱讀！— {{company_name}} 全體夥伴 🙌\n想調整收件頻率？管理訂閱偏好',
    ],
    luxurious: [
      '{{company_name}}\nExclusive Service Line: {{phone}}\n© {{year}} {{company_name}} — Crafted with Excellence',
      '{{company_name}} — 追求極致\nVIP 專線：{{phone}}\n取消訂閱 | 聯繫私人顧問',
      '{{company_name}}\n尊榮客服：{{phone}} | {{email}}\n© {{year}} {{company_name}}',
    ],
  },
}

// ═══════════════════════════════════════════════════════════
// 輔助工具函式
// ═══════════════════════════════════════════════════════════

/** 從陣列中隨機挑選一個元素 */
function pick(arr) {
  if (!arr || arr.length === 0) return ''
  return arr[Math.floor(Math.random() * arr.length)]
}

/** 從陣列中隨機挑選 N 個不重複元素 */
function pickN(arr, n) {
  if (!arr || arr.length === 0) return []
  const shuffled = [...arr].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, Math.min(n, arr.length))
}

/** 將模板中的 {{variable}} 替換為實際值 */
function interpolate(template, vars) {
  if (!template) return ''
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return vars[key] !== undefined ? vars[key] : match
  })
}

/** 計算字串的中文 + 英文字數（中文算 1 字，英文單詞算 1 字）*/
function countWords(text) {
  if (!text) return 0
  const chinese = (text.match(/[\u4e00-\u9fff]/g) || []).length
  const english = (text.replace(/[\u4e00-\u9fff]/g, ' ').match(/[a-zA-Z]+/g) || []).length
  return chinese + english
}

// ═══════════════════════════════════════════════════════════
// 1. generateEmailTemplate — 產生完整 Email 模板
// ═══════════════════════════════════════════════════════════
/**
 * 根據參數產生完整的 Email 模板
 * @param {Object} params
 * @param {string} params.purpose - 郵件目的
 * @param {string} params.tone - 語氣
 * @param {string} [params.industry] - 產業別
 * @param {string} [params.targetAudience] - 目標受眾
 * @param {string} [params.productName] - 產品名稱
 * @param {string} [params.companyName] - 公司名稱
 * @param {string} [params.language='zh-TW'] - 語言
 * @returns {Object} 完整 Email 模板
 */
export function generateEmailTemplate(params) {
  const {
    purpose = 'welcome',
    tone = 'professional',
    industry = '',
    targetAudience = '',
    productName = '我們的產品',
    companyName = '我們',
    language = 'zh-TW',
  } = params || {}

  const vars = {
    customer_name: '{{customer_name}}',
    company_name: companyName,
    product_name: productName,
    year: new Date().getFullYear().toString(),
    discount: '85 折',
    promo_code: 'SAVE15',
    end_date: '本月底',
    original_price: 'NT$1,980',
    sale_price: 'NT$1,490',
    order_id: '{{order_id}}',
    delivery_date: '{{delivery_date}}',
    reward: '50 元購物金',
    event_date: '{{event_date}}',
    event_time: '{{event_time}}',
    event_location: '{{event_location}}',
    speaker_name: '{{speaker_name}}',
    effective_date: '{{effective_date}}',
    bonus: '精美贈品',
    hours: '48',
    count: '500',
    percentage: '98',
    phone: '{{phone}}',
    email: '{{email}}',
    company_address: '{{company_address}}',
    tax_id: '{{tax_id}}',
    platform: 'Google',
    rating: '4.9',
    testimonial: '非常推薦，服務品質一流！',
    reviewer_name: '王先生',
    reviewer_company: '科技有限公司',
    industry: industry || '各產業',
    years: '5',
  }

  // 組合各區塊
  const greeting = interpolate(pick(AI_CONTENT_BLOCKS.greetings[tone] || AI_CONTENT_BLOCKS.greetings.professional), vars)
  const opening = interpolate(pick(AI_CONTENT_BLOCKS.openings[purpose] || AI_CONTENT_BLOCKS.openings.welcome), vars)
  const bodyText = interpolate(pick(AI_CONTENT_BLOCKS.bodies[purpose] || AI_CONTENT_BLOCKS.bodies.welcome), vars)
  const closing = interpolate(pick(AI_CONTENT_BLOCKS.closings[tone] || AI_CONTENT_BLOCKS.closings.professional), vars)
  const ctaText = pick(AI_CONTENT_BLOCKS.ctas[purpose] || AI_CONTENT_BLOCKS.ctas.welcome)
  const ctaInterpolated = interpolate(ctaText, vars)
  const footerTone = tone === 'luxurious' ? 'luxurious' : tone === 'friendly' || tone === 'playful' ? 'friendly' : 'professional'
  const footer = interpolate(pick(AI_CONTENT_BLOCKS.footers[footerTone] || AI_CONTENT_BLOCKS.footers.professional), vars)

  // 產生主旨行
  const subjectLines = generateSubjectLines({ purpose, productName, tone, emoji: tone === 'playful' || tone === 'friendly' })
  const subject = subjectLines[0]

  // 產生 preheader（主旨下方預覽文字）
  const preheaderMap = {
    welcome: `歡迎加入 ${companyName}！快來看看有什麼好康`,
    promotion: `限時優惠進行中，千萬別錯過`,
    newsletter: `${companyName} 本期精選內容`,
    announcement: `${companyName} 有重要消息要告訴您`,
    follow_up: `我們想跟您聊聊`,
    thank_you: `感謝您的購買！訂單確認資訊`,
    feedback: `花 2 分鐘告訴我們您的想法`,
    reactivation: `好久不見！為您準備了專屬好禮`,
    event_invitation: `不容錯過的精彩活動邀請`,
    product_launch: `全新 ${productName} 正式登場！`,
  }
  const preheader = preheaderMap[purpose] || preheaderMap.welcome

  // 組合完整正文
  const body = `${opening}\n\n${bodyText}`

  // 選擇設計預設
  const designMap = {
    professional: EMAIL_DESIGN_PRESETS.classic,
    friendly: EMAIL_DESIGN_PRESETS.modern,
    urgent: EMAIL_DESIGN_PRESETS.bold,
    luxurious: EMAIL_DESIGN_PRESETS.elegant,
    playful: EMAIL_DESIGN_PRESETS.modern,
  }
  const design = designMap[tone] || EMAIL_DESIGN_PRESETS.minimal

  // 產生完整 HTML
  const fullHtml = `<!DOCTYPE html>
<html lang="${language}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${subject}</title>
<style>
  body { margin:0; padding:0; background:${design.bgColor}; font-family:${design.fontFamily}; color:${design.textColor}; line-height:1.8; }
  .container { max-width:600px; margin:0 auto; background:#fff; }
  .header { ${design.headerStyle} }
  .content { padding:32px 24px; }
  .cta-wrapper { text-align:center; padding:24px 0; }
  .cta-btn { ${design.buttonStyle} }
  .footer { padding:24px; font-size:12px; color:#9ca3af; text-align:center; border-top:1px solid #e5e7eb; white-space:pre-line; }
  .preheader { display:none; max-height:0; overflow:hidden; }
</style>
</head>
<body>
<div class="preheader">${preheader}</div>
<div class="container">
  <div class="header">
    <h1 style="margin:0;font-size:22px;">${companyName}</h1>
  </div>
  <div class="content">
    <p>${greeting}</p>
    <p>${opening}</p>
    <div style="white-space:pre-line;">${bodyText}</div>
    <div class="cta-wrapper">
      <a href="{{cta_url}}" class="cta-btn">${ctaInterpolated}</a>
    </div>
    <p>${closing}</p>
  </div>
  <div class="footer">${footer}</div>
</div>
</body>
</html>`

  return {
    subject,
    preheader,
    greeting,
    body,
    cta_text: ctaInterpolated,
    cta_url_placeholder: '{{cta_url}}',
    closing,
    footer,
    fullHtml,
  }
}

// ═══════════════════════════════════════════════════════════
// 2. generateSubjectLines — 產生 5 個主旨行變體
// ═══════════════════════════════════════════════════════════
/**
 * 產生 5 個風格各異的主旨行
 * @param {Object} params
 * @param {string} params.purpose - 郵件目的
 * @param {string} [params.productName] - 產品名稱
 * @param {string} [params.tone] - 語氣
 * @param {boolean} [params.emoji=false] - 是否加入 emoji
 * @returns {string[]} 5 個主旨行
 */
export function generateSubjectLines(params) {
  const {
    purpose = 'welcome',
    productName = '',
    tone = 'professional',
    emoji = false,
  } = params || {}

  const product = productName || '我們的產品'

  // 主旨行模板庫（依目的 × 策略分類）
  const templates = {
    welcome: {
      question: `準備好開始了嗎？歡迎加入我們`,
      benefit: `您的帳號已啟用 — 專屬好禮等您領`,
      urgency: `歡迎！首購優惠限時 72 小時`,
      curiosity: `加入後的第一步，很多人都不知道…`,
      personalization: `{{customer_name}}，歡迎加入！為您準備了驚喜`,
    },
    promotion: {
      question: `還在猶豫？現在是最佳入手時機`,
      benefit: `${product} 限時優惠，最高省下 40%`,
      urgency: `倒數 48 小時！${product} 特惠即將結束`,
      curiosity: `這個優惠只有少數人知道…`,
      personalization: `{{customer_name}} 專屬折扣碼已備好`,
    },
    newsletter: {
      question: `本週最值得關注的趨勢是什麼？`,
      benefit: `3 個立即可用的實戰技巧`,
      urgency: `本週精選 — 別讓競爭對手搶先看到`,
      curiosity: `我們發現了一個有趣的新趨勢…`,
      personalization: `{{customer_name}}，為您精選的本月好文`,
    },
    announcement: {
      question: `您聽說了嗎？我們有重大消息`,
      benefit: `全新升級，為您帶來更好的體驗`,
      urgency: `重要公告：請在本週內查看`,
      curiosity: `我們醞釀很久的事，終於可以說了`,
      personalization: `{{customer_name}}，第一時間與您分享這個消息`,
    },
    follow_up: {
      question: `上次的提案，您考慮得如何了？`,
      benefit: `想再多了解 ${product} 嗎？這裡有更多資訊`,
      urgency: `優惠保留即將到期，把握最後機會`,
      curiosity: `很多客戶跟您一樣，最後都選擇了…`,
      personalization: `{{customer_name}}，快速跟進一下上次的討論`,
    },
    thank_you: {
      question: `訂單確認 — 下一步是什麼？`,
      benefit: `感謝您的購買！這裡有份驚喜`,
      urgency: `訂單已成立，預計很快送達`,
      curiosity: `感謝購買！順便跟您分享一個小秘密`,
      personalization: `{{customer_name}}，感謝您的訂單 🙏`,
    },
    feedback: {
      question: `使用 ${product} 還滿意嗎？`,
      benefit: `花 2 分鐘回饋，獲得購物金獎勵`,
      urgency: `問卷即將截止 — 您的意見很重要`,
      curiosity: `我們改進了 3 項功能，都是因為客戶回饋`,
      personalization: `{{customer_name}}，想聽聽您的真實想法`,
    },
    reactivation: {
      question: `好久不見，最近過得好嗎？`,
      benefit: `回歸專屬禮：限定折扣等您領取`,
      urgency: `限時回歸優惠，7 天內有效`,
      curiosity: `自從您上次來過之後，我們改變了很多…`,
      personalization: `{{customer_name}}，我們想念您了`,
    },
    event_invitation: {
      question: `這場活動，您有興趣嗎？`,
      benefit: `免費參加！一場能改變思維的活動`,
      urgency: `名額倒數中 — 趕快報名`,
      curiosity: `業界大咖齊聚，他們會聊什麼？`,
      personalization: `{{customer_name}}，特別為您保留了席位`,
    },
    product_launch: {
      question: `準備好迎接全新 ${product} 了嗎？`,
      benefit: `${product} 正式上市 — 搶先體驗新功能`,
      urgency: `早鳥限定！${product} 上市首週特惠`,
      curiosity: `我們花了 18 個月打造的秘密武器，終於登場`,
      personalization: `{{customer_name}}，${product} 為您而來`,
    },
  }

  const purposeTemplates = templates[purpose] || templates.welcome
  const lines = [
    purposeTemplates.question,
    purposeTemplates.benefit,
    purposeTemplates.urgency,
    purposeTemplates.curiosity,
    purposeTemplates.personalization,
  ]

  // 根據語氣微調
  const tonePrefix = {
    urgent: '⚡ ',
    playful: '🎉 ',
    luxurious: '✦ ',
  }

  // 根據 emoji 設定加入前綴
  if (emoji) {
    const emojiMap = {
      welcome: ['🎉', '👋', '🚀', '✨', '🎊'],
      promotion: ['🔥', '💰', '⏰', '🎁', '💎'],
      newsletter: ['📰', '💡', '📊', '🔍', '📌'],
      announcement: ['📢', '🆕', '⚡', '🤫', '💌'],
      follow_up: ['👀', '📋', '⏳', '💭', '🤝'],
      thank_you: ['🙏', '🎁', '📦', '🤫', '❤️'],
      feedback: ['💬', '🎁', '⏰', '🔧', '👂'],
      reactivation: ['👋', '🎁', '⏰', '🔄', '💕'],
      event_invitation: ['🎪', '🎓', '⏳', '🎤', '💺'],
      product_launch: ['🚀', '🆕', '🏷️', '🔬', '🎯'],
    }
    const emojis = emojiMap[purpose] || emojiMap.welcome
    return lines.map((line, i) => `${emojis[i]} ${line}`)
  }

  // 非 emoji 模式但有語氣前綴
  if (tonePrefix[tone]) {
    return lines.map(line => `${tonePrefix[tone]}${line}`)
  }

  return lines
}

// ═══════════════════════════════════════════════════════════
// 3. generateCTAVariations — 產生 5 個 CTA 按鈕變體
// ═══════════════════════════════════════════════════════════
/**
 * 根據郵件目的產生 5 個 CTA 按鈕文字與樣式
 * @param {string} purpose - 郵件目的
 * @returns {Array<{text: string, style: 'primary'|'secondary'|'urgent'}>}
 */
export function generateCTAVariations(purpose) {
  const variations = {
    welcome: [
      { text: '開始探索', style: 'primary' },
      { text: '完善我的資料', style: 'secondary' },
      { text: '領取歡迎禮', style: 'primary' },
      { text: '查看新手指南', style: 'secondary' },
      { text: '立即體驗', style: 'primary' },
    ],
    promotion: [
      { text: '立即搶購', style: 'urgent' },
      { text: '使用折扣碼', style: 'primary' },
      { text: '查看優惠詳情', style: 'secondary' },
      { text: '加入購物車', style: 'primary' },
      { text: '限時特惠 — 立即行動', style: 'urgent' },
    ],
    newsletter: [
      { text: '閱讀完整文章', style: 'primary' },
      { text: '了解更多', style: 'secondary' },
      { text: '前往部落格', style: 'secondary' },
      { text: '訂閱更多內容', style: 'primary' },
      { text: '分享給朋友', style: 'secondary' },
    ],
    announcement: [
      { text: '查看完整公告', style: 'primary' },
      { text: '了解更多細節', style: 'secondary' },
      { text: '立即體驗新功能', style: 'primary' },
      { text: '前往查看', style: 'secondary' },
      { text: '搶先體驗', style: 'primary' },
    ],
    follow_up: [
      { text: '預約免費 Demo', style: 'primary' },
      { text: '回覆此信件', style: 'secondary' },
      { text: '了解更多資訊', style: 'secondary' },
      { text: '開始免費試用', style: 'primary' },
      { text: '安排通話時間', style: 'primary' },
    ],
    thank_you: [
      { text: '追蹤我的訂單', style: 'primary' },
      { text: '繼續購物', style: 'secondary' },
      { text: '推薦好友賺回饋', style: 'primary' },
      { text: '查看訂單明細', style: 'secondary' },
      { text: '聯繫客服', style: 'secondary' },
    ],
    feedback: [
      { text: '立即填寫問卷', style: 'primary' },
      { text: '分享我的想法', style: 'primary' },
      { text: '快速評分（1 分鐘）', style: 'secondary' },
      { text: '撰寫評論', style: 'secondary' },
      { text: '填問卷領獎勵', style: 'urgent' },
    ],
    reactivation: [
      { text: '回來看看', style: 'primary' },
      { text: '領取回歸優惠', style: 'urgent' },
      { text: '查看最新商品', style: 'secondary' },
      { text: '重新啟用帳號', style: 'primary' },
      { text: '專屬優惠等你拿', style: 'urgent' },
    ],
    event_invitation: [
      { text: '立即報名', style: 'primary' },
      { text: '預約我的席位', style: 'primary' },
      { text: '查看活動議程', style: 'secondary' },
      { text: '免費報名參加', style: 'urgent' },
      { text: '加入行事曆', style: 'secondary' },
    ],
    product_launch: [
      { text: '搶先體驗', style: 'primary' },
      { text: '立即購買', style: 'urgent' },
      { text: '觀看產品介紹', style: 'secondary' },
      { text: '早鳥預購', style: 'urgent' },
      { text: '了解核心功能', style: 'secondary' },
    ],
  }

  return variations[purpose] || variations.welcome
}

// ═══════════════════════════════════════════════════════════
// 4. improveContent — AI 改善既有內容
// ═══════════════════════════════════════════════════════════
/**
 * 根據指令改善既有內容
 * @param {string} originalContent - 原始內容
 * @param {string} instruction - 改善指令
 * @returns {{improved: string, changes: string[]}}
 */
export function improveContent(originalContent, instruction) {
  if (!originalContent) {
    return { improved: '', changes: ['原始內容為空，無法改善'] }
  }

  let improved = originalContent
  const changes = []

  switch (instruction) {
    case 'shorter': {
      // 精簡策略：移除冗詞、縮短句子
      const replacements = [
        [/非常|十分|極為|相當|特別/g, '很'],
        [/進行\s*了?\s*/g, ''],
        [/的話/g, ''],
        [/其實|事實上|老實說/g, ''],
        [/目前為止|到目前為止/g, '目前'],
        [/在這裡|在此/g, ''],
        [/可以說是/g, '是'],
        [/不得不說/g, ''],
      ]
      for (const [pattern, replacement] of replacements) {
        if (pattern.test(improved)) {
          improved = improved.replace(pattern, replacement)
          changes.push('移除冗詞贅字')
          break
        }
      }
      // 縮短過長段落（以句號分割取前半）
      const sentences = improved.split(/[。！？]/).filter(Boolean)
      if (sentences.length > 4) {
        improved = sentences.slice(0, Math.ceil(sentences.length * 0.6)).join('。') + '。'
        changes.push(`段落從 ${sentences.length} 句精簡為 ${Math.ceil(sentences.length * 0.6)} 句`)
      }
      if (changes.length === 0) changes.push('內容已足夠精簡')
      break
    }

    case 'more_urgent': {
      // 加入緊迫感元素
      const urgencyPhrases = pickN(AI_CONTENT_BLOCKS.urgency, 2)
      improved = `⚡ ${improved}\n\n🔥 ${urgencyPhrases.join(' | ')}！機會稍縱即逝，立即行動！`
      changes.push('加入緊迫感語句')
      changes.push('加入 emoji 強調符號')
      changes.push('加入行動呼籲結尾')
      break
    }

    case 'more_friendly': {
      // 調整為更親切的語氣
      improved = improved
        .replace(/您/g, '你')
        .replace(/敬請/g, '歡迎')
        .replace(/煩請/g, '請')
        .replace(/惠予/g, '給我們')
        .replace(/謝謝您/g, '謝謝你')
        .replace(/。$/g, '～')
      improved = improved + ' 😊'
      changes.push('將「您」改為「你」，拉近距離')
      changes.push('將正式用語改為口語化表達')
      changes.push('加入表情符號增添親切感')
      break
    }

    case 'add_social_proof': {
      // 加入社會證明
      const proofs = pickN(AI_CONTENT_BLOCKS.social_proof, 3)
      const proofBlock = proofs.map(p => `✅ ${p}`).join('\n')
      improved = `${improved}\n\n💪 為什麼大家都選擇我們？\n${proofBlock}`
      changes.push('加入社會證明區塊')
      changes.push('加入 3 條社會證明語句')
      changes.push('使用條列式增強可讀性')
      break
    }

    case 'add_scarcity': {
      // 加入稀缺性元素
      const scarcityPhrases = pickN(AI_CONTENT_BLOCKS.urgency, 2)
      improved = `${improved}\n\n⏰ ${scarcityPhrases[0]}！${scarcityPhrases[1] || '把握最後機會'}。\n\n⚠️ 提醒：此優惠不與其他活動併用，逾期恕不延長。`
      changes.push('加入稀缺性提示')
      changes.push('加入限時限量警語')
      changes.push('加入活動條款提醒（增加真實感）')
      break
    }

    case 'more_professional': {
      // 調整為更專業的語氣
      improved = improved
        .replace(/你/g, '您')
        .replace(/嗨|哈囉|Hey/g, '您好')
        .replace(/～/g, '。')
        .replace(/！{2,}/g, '。')
        .replace(/😊|😀|🎉|👋|❤️|🚀|✨|🎊|🌟|🎮|🌈|🎁/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim()
      changes.push('將「你」改為「您」，提升正式感')
      changes.push('移除表情符號')
      changes.push('將口語化標點替換為正式標點')
      break
    }

    default:
      changes.push(`不支援的指令: ${instruction}`)
  }

  return { improved: improved.trim(), changes }
}

// ═══════════════════════════════════════════════════════════
// 5. generatePersonalizationSuggestions — 個人化變數建議
// ═══════════════════════════════════════════════════════════
/**
 * 掃描模板內容，建議可插入的個人化變數
 * @param {string} template - 模板內容（純文字或 HTML）
 * @returns {Array<{position: string, suggestion: string, variable: string, example: string}>}
 */
export function generatePersonalizationSuggestions(template) {
  if (!template) return []

  const suggestions = []

  // 定義掃描規則：關鍵字 → 建議的個人化變數
  const rules = [
    {
      pattern: /親愛的客戶|親愛的用戶|親愛的朋友|Dear Customer/i,
      position: '稱呼',
      suggestion: '使用客戶真實姓名取代通用稱呼',
      variable: '{{customer_name}}',
      example: '親愛的 王小明 您好',
    },
    {
      pattern: /您(?:購買|訂購|選購)的(?:商品|產品)/,
      position: '商品提及處',
      suggestion: '插入實際購買的商品名稱',
      variable: '{{product_name}}',
      example: '您購買的 精品咖啡豆禮盒',
    },
    {
      pattern: /上次|之前|先前/,
      position: '時間參照處',
      suggestion: '插入具體的上次互動日期',
      variable: '{{last_interaction_date}}',
      example: '自 3 月 15 日 以來',
    },
    {
      pattern: /訂單/,
      position: '訂單相關段落',
      suggestion: '插入訂單編號方便客戶查詢',
      variable: '{{order_id}}',
      example: '您的訂單 #ORD-20260405-001',
    },
    {
      pattern: /優惠|折扣|特價/,
      position: '優惠相關段落',
      suggestion: '插入個人化折扣碼或金額',
      variable: '{{discount_code}}',
      example: '您的專屬折扣碼 VIP2026',
    },
    {
      pattern: /推薦|可能喜歡|適合您/,
      position: '推薦區塊',
      suggestion: '根據購買歷史推薦相關商品',
      variable: '{{recommended_products}}',
      example: '根據您之前購買的咖啡豆，推薦手沖壺組',
    },
    {
      pattern: /會員|VIP|等級/,
      position: '會員資訊處',
      suggestion: '顯示客戶的會員等級或點數',
      variable: '{{membership_level}}',
      example: '金卡會員，目前累積 2,350 點',
    },
    {
      pattern: /生日|週年|紀念/,
      position: '特殊日期處',
      suggestion: '插入客戶的生日或重要紀念日',
      variable: '{{birthday}}',
      example: '祝您 5 月 20 日 生日快樂',
    },
    {
      pattern: /地區|地點|城市|門市|分店/,
      position: '地點相關段落',
      suggestion: '顯示客戶所在地區或最近門市',
      variable: '{{nearest_store}}',
      example: '台北信義門市（距您最近）',
    },
    {
      pattern: /金額|花費|消費|累計/,
      position: '消費相關段落',
      suggestion: '插入客戶的歷史消費金額',
      variable: '{{total_spent}}',
      example: '您累計消費 NT$12,500',
    },
  ]

  // 檢查模板中是否尚未使用某些基本個人化變數
  const hasCustomerName = /\{\{customer_name\}\}/.test(template)
  const hasCompanyName = /\{\{company_name\}\}/.test(template)

  if (!hasCustomerName) {
    suggestions.push({
      position: '信件開頭',
      suggestion: '加入客戶姓名讓信件更有個人感',
      variable: '{{customer_name}}',
      example: '親愛的 王小明 您好',
    })
  }

  if (!hasCompanyName) {
    suggestions.push({
      position: '品牌提及處',
      suggestion: '使用公司名稱變數方便多品牌共用模板',
      variable: '{{company_name}}',
      example: '感謝您選擇 好時光有限公司',
    })
  }

  // 依規則掃描
  for (const rule of rules) {
    if (rule.pattern.test(template)) {
      // 確認該變數尚未在模板中使用
      const varPattern = new RegExp(rule.variable.replace(/[{}]/g, '\\$&'))
      if (!varPattern.test(template)) {
        suggestions.push({
          position: rule.position,
          suggestion: rule.suggestion,
          variable: rule.variable,
          example: rule.example,
        })
      }
    }
  }

  return suggestions
}

// ═══════════════════════════════════════════════════════════
// 6. scoreEmailTemplate — 模板品質評分
// ═══════════════════════════════════════════════════════════
/**
 * 評估 Email 模板品質（0–100 分）
 * @param {Object} template - 模板物件（至少含 subject, body 等欄位）
 * @returns {{score: number, breakdown: Array<{criterion: string, score: number, max: number, suggestion: string}>}}
 */
export function scoreEmailTemplate(template) {
  if (!template) {
    return { score: 0, breakdown: [{ criterion: '模板內容', score: 0, max: 100, suggestion: '請提供模板內容以進行評分' }] }
  }

  const breakdown = []

  // 取得各欄位（支援物件或純字串）
  const subject = template.subject || ''
  const body = template.body || (typeof template === 'string' ? template : '')
  const ctaText = template.cta_text || ''
  const fullText = `${subject} ${body} ${ctaText}`

  // ── 1. 主旨行長度（滿分 15 分）──
  {
    const len = subject.length
    let score = 0
    let suggestion = ''
    if (len === 0) {
      score = 0
      suggestion = '缺少主旨行，請加入主旨'
    } else if (len >= 40 && len <= 60) {
      score = 15
      suggestion = '主旨長度理想 👍'
    } else if (len >= 20 && len < 40) {
      score = 10
      suggestion = '主旨稍短，建議 40–60 字元為最佳'
    } else if (len > 60 && len <= 80) {
      score = 10
      suggestion = '主旨稍長，可能在手機上被截斷'
    } else if (len < 20) {
      score = 5
      suggestion = '主旨過短，可能無法吸引開信'
    } else {
      score = 5
      suggestion = '主旨過長，建議控制在 60 字元以內'
    }
    breakdown.push({ criterion: '主旨行長度', score, max: 15, suggestion })
  }

  // ── 2. 是否包含 CTA（滿分 15 分）──
  {
    let score = 0
    let suggestion = ''
    if (ctaText || /立即|前往|了解更多|點擊|報名|購買|體驗|查看/u.test(body)) {
      score = 15
      suggestion = '包含明確的行動呼籲 👍'
    } else {
      score = 0
      suggestion = '缺少行動呼籲（CTA），建議加入引導讀者下一步的按鈕或連結'
    }
    breakdown.push({ criterion: '行動呼籲 (CTA)', score, max: 15, suggestion })
  }

  // ── 3. 個人化程度（滿分 15 分）──
  {
    const personalVars = (fullText.match(/\{\{[^}]+\}\}/g) || [])
    const uniqueVars = [...new Set(personalVars)]
    let score = 0
    let suggestion = ''
    if (uniqueVars.length >= 3) {
      score = 15
      suggestion = `使用了 ${uniqueVars.length} 個個人化變數，優秀 👍`
    } else if (uniqueVars.length === 2) {
      score = 10
      suggestion = '有基本的個人化，建議再增加更多變數'
    } else if (uniqueVars.length === 1) {
      score = 5
      suggestion = '僅有 1 個個人化變數，建議增加如 {{customer_name}} 等'
    } else {
      score = 0
      suggestion = '完全沒有個人化變數，這會降低開信率與點擊率'
    }
    breakdown.push({ criterion: '個人化程度', score, max: 15, suggestion })
  }

  // ── 4. 內文字數（滿分 15 分）──
  {
    const wc = countWords(body)
    let score = 0
    let suggestion = ''
    if (wc >= 50 && wc <= 300) {
      score = 15
      suggestion = `字數 ${wc}，長度適中 👍`
    } else if (wc >= 30 && wc < 50) {
      score = 10
      suggestion = `字數 ${wc}，略短，建議補充更多內容`
    } else if (wc > 300 && wc <= 500) {
      score = 10
      suggestion = `字數 ${wc}，略長，建議精簡以提高閱讀率`
    } else if (wc < 30) {
      score = 5
      suggestion = `字數 ${wc}，內容過少，可能無法有效傳達訊息`
    } else {
      score = 5
      suggestion = `字數 ${wc}，內容過長，大部分讀者不會看完`
    }
    breakdown.push({ criterion: '內文字數', score, max: 15, suggestion })
  }

  // ── 5. 可讀性（滿分 15 分）──
  {
    let score = 15
    let suggestion = '可讀性良好 👍'
    const issues = []

    // 檢查是否有段落分隔
    if (body.length > 200 && !/\n\n|\<br\s*\/?\>/.test(body)) {
      score -= 5
      issues.push('缺少段落分隔')
    }
    // 檢查是否有列表或結構化元素
    if (body.length > 300 && !/[•\-\d]\.|<li|<ul|<ol|\n[1-9]/.test(body)) {
      score -= 3
      issues.push('建議加入條列式內容提高可讀性')
    }
    // 檢查句子長度（連續超過 80 字無標點）
    if (/[^\n。！？，、]{80,}/.test(body)) {
      score -= 4
      issues.push('存在過長的句子，建議適當斷句')
    }

    if (issues.length > 0) {
      suggestion = issues.join('；')
    }
    breakdown.push({ criterion: '可讀性', score: Math.max(0, score), max: 15, suggestion })
  }

  // ── 6. 垃圾郵件風險（滿分 15 分）──
  {
    const lowerText = fullText.toLowerCase()
    const triggered = SPAM_TRIGGER_WORDS.filter(word => lowerText.includes(word.toLowerCase()))
    let score = 15
    let suggestion = '未偵測到垃圾郵件觸發詞 👍'

    if (triggered.length >= 5) {
      score = 0
      suggestion = `偵測到 ${triggered.length} 個垃圾郵件觸發詞：${triggered.slice(0, 5).join('、')}…`
    } else if (triggered.length >= 3) {
      score = 5
      suggestion = `偵測到 ${triggered.length} 個觸發詞：${triggered.join('、')}，建議替換`
    } else if (triggered.length >= 1) {
      score = 10
      suggestion = `偵測到 ${triggered.length} 個觸發詞：${triggered.join('、')}，注意避免`
    }
    breakdown.push({ criterion: '垃圾郵件風險', score, max: 15, suggestion })
  }

  // ── 7. Emoji 使用（滿分 10 分）──
  {
    const emojis = fullText.match(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}\u{FE0F}]/gu) || []
    let score = 0
    let suggestion = ''
    if (emojis.length >= 1 && emojis.length <= 5) {
      score = 10
      suggestion = `使用了 ${emojis.length} 個 emoji，適度且吸睛 👍`
    } else if (emojis.length === 0) {
      score = 6
      suggestion = '未使用 emoji，適度加入可提高開信率 2-5%'
    } else {
      score = 4
      suggestion = `使用了 ${emojis.length} 個 emoji，數量過多可能影響專業形象`
    }
    breakdown.push({ criterion: 'Emoji 使用', score, max: 10, suggestion })
  }

  // 計算總分
  const totalScore = breakdown.reduce((sum, item) => sum + item.score, 0)

  return { score: totalScore, breakdown }
}
