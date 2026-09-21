import { AI_CONTENT_BLOCKS } from './contentBlocks'
import { SPAM_TRIGGER_WORDS, EMAIL_DESIGN_PRESETS } from './spamAndDesign'

// ═══════════════════════════════════════════════════════════
// 輔助工具函式（私有）
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
  const chinese = (text.match(/[一-鿿]/g) || []).length
  const english = (text.replace(/[一-鿿]/g, ' ').match(/[a-zA-Z]+/g) || []).length
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
