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
