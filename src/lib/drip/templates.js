// ══════════════════════════════════════════════
// 預建行銷活動範本
// ══════════════════════════════════════════════
export const DRIP_TEMPLATES = [
  // ── 歡迎系列 ──
  {
    id: 'welcome_series',
    name: '歡迎系列',
    nameEn: 'Welcome Series',
    description: '新客戶加入後的歡迎郵件序列',
    trigger: 'new_customer',
    steps: [
      {
        delay_days: 0,
        delay_hours: 0,
        type: 'email',
        subject: '歡迎加入 {{company_name}}！您的專屬旅程開始了',
        content:
          '親愛的 {{customer_name}} 您好，\n\n' +
          '感謝您加入 {{company_name}} 的大家庭！我們非常高興能為您服務。\n\n' +
          '為了讓您更快速了解我們，以下是幾個實用的入門資訊：\n' +
          '• 📋 會員中心：隨時查看訂單與點數\n' +
          '• 🎁 新會員禮：輸入折扣碼 {{discount_code}} 即享首單 9 折\n' +
          '• 📞 客服專線：週一至週五 09:00-18:00\n\n' +
          '如有任何問題，歡迎隨時與我們聯繫。\n\n' +
          '祝您購物愉快！\n' +
          '{{company_name}} 團隊 敬上',
      },
      {
        delay_days: 3,
        delay_hours: 0,
        type: 'email',
        subject: '{{customer_name}}，來看看我們最受歡迎的產品吧！',
        content:
          '親愛的 {{customer_name}} 您好，\n\n' +
          '加入 {{company_name}} 已經幾天了，不知道您是否已經逛過我們的商品呢？\n\n' +
          '以下是本月最受歡迎的熱銷商品：\n' +
          '🏆 TOP 1：{{popular_product_1}}\n' +
          '🥈 TOP 2：{{popular_product_2}}\n' +
          '🥉 TOP 3：{{popular_product_3}}\n\n' +
          '每一款都經過我們團隊的嚴格挑選，品質值得信賴。\n\n' +
          '👉 點此查看完整產品目錄：{{product_catalog_url}}\n\n' +
          '{{company_name}} 團隊 敬上',
      },
      {
        delay_days: 7,
        delay_hours: 0,
        type: 'condition',
        field: 'opened_email',
        operator: 'eq',
        value: true,
        true_step: {
          type: 'email',
          subject: '{{customer_name}}，這是為您準備的專屬優惠 🎉',
          content:
            '親愛的 {{customer_name}} 您好，\n\n' +
            '感謝您持續關注 {{company_name}}！\n\n' +
            '我們為活躍會員準備了一份專屬好禮：\n' +
            '🎁 限時優惠碼：{{vip_discount_code}}\n' +
            '💰 全站商品享 85 折，優惠期限至 {{offer_expiry_date}}\n\n' +
            '趁現在把心儀商品帶回家吧！\n\n' +
            '{{company_name}} 團隊 敬上',
        },
        false_step: {
          type: 'email',
          subject: '{{customer_name}}，我們想念您！',
          content:
            '親愛的 {{customer_name}} 您好，\n\n' +
            '我們注意到您最近還沒有開啟我們的信件，不知道是不是信件跑到垃圾郵件了呢？\n\n' +
            '為了確保您不會錯過任何好康，建議您：\n' +
            '✅ 將 {{sender_email}} 加入聯絡人\n' +
            '✅ 檢查垃圾郵件匣\n\n' +
            '這裡有一份小禮物等著您：\n' +
            '🎁 回歸禮金 NT$100，輸入折扣碼 {{comeback_code}} 即可使用\n\n' +
            '期待再次見到您！\n' +
            '{{company_name}} 團隊 敬上',
        },
      },
      {
        delay_days: 14,
        delay_hours: 0,
        type: 'email',
        subject: '{{customer_name}}，會員專屬好禮已送達 🎁',
        content:
          '親愛的 {{customer_name}} 您好，\n\n' +
          '感謝您成為 {{company_name}} 會員已滿兩週！\n\n' +
          '我們為您準備了以下會員專屬福利：\n' +
          '🌟 會員點數加倍：本週購物點數 ×2\n' +
          '🌟 免運門檻降低：滿 NT$500 即免運\n' +
          '🌟 搶先預購：新品上架前 48 小時優先選購權\n\n' +
          '別忘了隨時到會員中心查看您的點數餘額與專屬優惠。\n\n' +
          '感謝您的支持！\n' +
          '{{company_name}} 團隊 敬上',
      },
    ],
  },

  // ── 購物車挽回 ──
  {
    id: 'abandoned_cart',
    name: '購物車挽回',
    nameEn: 'Abandoned Cart Recovery',
    description: '客戶放棄購物車後的挽回序列',
    trigger: 'abandoned_cart',
    steps: [
      {
        delay_days: 0,
        delay_hours: 1,
        type: 'email',
        subject: '{{customer_name}}，您的購物車還有商品等著結帳！',
        content:
          '親愛的 {{customer_name}} 您好，\n\n' +
          '您似乎忘了完成結帳，以下商品仍在您的購物車中：\n\n' +
          '🛒 {{cart_items}}\n\n' +
          '商品庫存有限，建議您盡早完成訂購以免向隅。\n\n' +
          '👉 立即結帳：{{checkout_url}}\n\n' +
          '如果您在結帳過程中遇到任何問題，歡迎聯繫我們的客服團隊，\n' +
          '我們很樂意為您協助。\n\n' +
          '{{company_name}} 團隊 敬上',
      },
      {
        delay_days: 1,
        delay_hours: 0,
        type: 'line',
        content:
          '嗨 {{customer_name}}！您的購物車還有 {{cart_item_count}} 件商品等著您 🛒\n' +
          '庫存即時更新中，熱門商品隨時可能售完！\n' +
          '👉 立即結帳：{{checkout_url}}',
      },
      {
        delay_days: 3,
        delay_hours: 0,
        type: 'email',
        subject: '{{customer_name}}，限時優惠 — 購物車商品享 9 折！',
        content:
          '親愛的 {{customer_name}} 您好，\n\n' +
          '我們知道有時候需要多考慮一下，完全理解！\n\n' +
          '為了感謝您對 {{company_name}} 的關注，我們特別為您準備了一個限時優惠：\n\n' +
          '🏷️ 折扣碼：{{discount_code}}\n' +
          '💰 購物車商品一律 9 折\n' +
          '⏰ 優惠有效期限：{{offer_expiry_date}}\n\n' +
          '您的購物車商品：\n' +
          '{{cart_items}}\n\n' +
          '👉 使用折扣碼結帳：{{checkout_url}}\n\n' +
          '{{company_name}} 團隊 敬上',
      },
      {
        delay_days: 7,
        delay_hours: 0,
        type: 'condition',
        field: 'purchased',
        operator: 'eq',
        value: false,
        true_step: null,
        false_step: {
          type: 'email',
          subject: '最後機會！免運費 + 專屬折扣即將到期 ⏰',
          content:
            '親愛的 {{customer_name}} 您好，\n\n' +
            '這是我們最後一次提醒您——購物車中的商品優惠即將到期！\n\n' +
            '🚚 本次加碼：免運費優惠（不限金額）\n' +
            '🏷️ 折扣碼：{{final_discount_code}}\n' +
            '⏰ 最後期限：{{final_expiry_date}}\n\n' +
            '您的購物車商品：\n' +
            '{{cart_items}}\n\n' +
            '錯過這次就要等下次活動囉！\n' +
            '👉 立即結帳：{{checkout_url}}\n\n' +
            '{{company_name}} 團隊 敬上',
        },
      },
    ],
  },

  // ── 售後關懷 ──
  {
    id: 'post_purchase',
    name: '售後關懷',
    nameEn: 'Post-Purchase Nurture',
    description: '購買後的滿意度追蹤與回購推動',
    trigger: 'post_purchase',
    steps: [
      {
        delay_days: 1,
        delay_hours: 0,
        type: 'email',
        subject: '感謝您的訂購！訂單 #{{order_number}} 確認通知',
        content:
          '親愛的 {{customer_name}} 您好，\n\n' +
          '感謝您在 {{company_name}} 購物！您的訂單已成功建立。\n\n' +
          '📦 訂單編號：#{{order_number}}\n' +
          '📋 訂購商品：{{order_items}}\n' +
          '💰 訂單金額：NT${{order_total}}\n' +
          '🚚 預計出貨日：{{estimated_shipping_date}}\n\n' +
          '您可以隨時到會員中心查看物流進度。\n' +
          '如有任何疑問，歡迎聯繫客服。\n\n' +
          '{{company_name}} 團隊 敬上',
      },
      {
        delay_days: 3,
        delay_hours: 0,
        type: 'line',
        content:
          '{{customer_name}} 您好！您的訂單 #{{order_number}} 已出貨 📦\n' +
          '物流單號：{{tracking_number}}\n' +
          '預計 {{delivery_date}} 送達，請留意收件！',
      },
      {
        delay_days: 7,
        delay_hours: 0,
        type: 'email',
        subject: '{{customer_name}}，您的商品使用得還順利嗎？',
        content:
          '親愛的 {{customer_name}} 您好，\n\n' +
          '您購買的 {{product_name}} 應該已經到手一段時間了，\n' +
          '不知道使用起來是否滿意呢？\n\n' +
          '我們非常重視您的使用體驗，若有任何問題歡迎隨時回信告訴我們。\n\n' +
          '🌟 也歡迎您花 30 秒為商品留下評價，幫助更多人做出選擇：\n' +
          '👉 留下評價：{{review_url}}\n\n' +
          '感謝您的寶貴意見！\n' +
          '{{company_name}} 團隊 敬上',
      },
      {
        delay_days: 14,
        delay_hours: 0,
        type: 'condition',
        field: 'clicked_link',
        operator: 'eq',
        value: true,
        true_step: {
          type: 'email',
          subject: '感謝您的評價！這是您的回饋禮 🎁',
          content:
            '親愛的 {{customer_name}} 您好，\n\n' +
            '非常感謝您撥空為我們留下評價！\n\n' +
            '為了感謝您的回饋，我們為您準備了一份小禮物：\n' +
            '🎁 回饋禮金 NT$50，已自動存入您的會員帳戶\n' +
            '📌 下次消費即可折抵，無最低消費限制\n\n' +
            '期待再次為您服務！\n' +
            '{{company_name}} 團隊 敬上',
        },
        false_step: {
          type: 'email',
          subject: '{{customer_name}}，填寫問卷就送 NT$50 購物金！',
          content:
            '親愛的 {{customer_name}} 您好，\n\n' +
            '我們非常在意您的購物體驗，想請您花 1 分鐘填寫簡短問卷。\n\n' +
            '🎁 完成問卷即可獲得 NT$50 購物金\n' +
            '👉 填寫問卷：{{survey_url}}\n\n' +
            '您的每一則回饋都是我們進步的動力，感謝您！\n' +
            '{{company_name}} 團隊 敬上',
        },
      },
      {
        delay_days: 30,
        delay_hours: 0,
        type: 'email',
        subject: '{{customer_name}}，猜您可能也會喜歡這些 ✨',
        content:
          '親愛的 {{customer_name}} 您好，\n\n' +
          '根據您之前購買的 {{product_name}}，我們精選了幾款您可能感興趣的商品：\n\n' +
          '✨ {{recommended_product_1}} — NT${{recommended_price_1}}\n' +
          '✨ {{recommended_product_2}} — NT${{recommended_price_2}}\n' +
          '✨ {{recommended_product_3}} — NT${{recommended_price_3}}\n\n' +
          '🏷️ 會員回購優惠：結帳輸入 {{rebuy_code}} 享 88 折\n\n' +
          '👉 查看推薦商品：{{recommendations_url}}\n\n' +
          '{{company_name}} 團隊 敬上',
      },
    ],
  },

  // ── 沉睡客戶喚醒 ──
  {
    id: 'reengagement',
    name: '沉睡客戶喚醒',
    nameEn: 'Re-engagement',
    description: '30天未活動客戶的再互動序列',
    trigger: 'inactivity',
    steps: [
      {
        delay_days: 0,
        delay_hours: 0,
        type: 'email',
        subject: '{{customer_name}}，好久不見！我們想念您 ❤️',
        content:
          '親愛的 {{customer_name}} 您好，\n\n' +
          '我們發現您已經有一段時間沒有來 {{company_name}} 逛逛了，\n' +
          '不知道一切是否安好？\n\n' +
          '在您離開的這段時間，我們有了不少新變化：\n' +
          '🆕 新品上市：{{new_product_highlight}}\n' +
          '🔥 熱銷回歸：{{bestseller_highlight}}\n' +
          '🎊 限時活動：{{current_promotion}}\n\n' +
          '歡迎隨時回來逛逛，我們一直都在！\n\n' +
          '{{company_name}} 團隊 敬上',
      },
      {
        delay_days: 5,
        delay_hours: 0,
        type: 'line',
        content:
          '{{customer_name}} 您好，{{company_name}} 想您了！🥺\n' +
          '我們準備了專屬回歸禮等您來拿 🎁\n' +
          '👉 查看詳情：{{reengagement_url}}',
      },
      {
        delay_days: 10,
        delay_hours: 0,
        type: 'email',
        subject: '專屬回歸禮：{{customer_name}} 的 VIP 優惠券',
        content:
          '親愛的 {{customer_name}} 您好，\n\n' +
          '我們為您準備了一份專屬回歸禮：\n\n' +
          '🎁 VIP 回歸優惠券\n' +
          '💰 折扣碼：{{reengagement_code}}\n' +
          '💵 全站商品享 8 折（無低消限制）\n' +
          '🚚 加碼免運費\n' +
          '⏰ 有效期限：{{offer_expiry_date}}\n\n' +
          '這是我們特別為老朋友準備的，名額有限喔！\n\n' +
          '👉 立即選購：{{shop_url}}\n\n' +
          '{{company_name}} 團隊 敬上',
      },
      {
        delay_days: 20,
        delay_hours: 0,
        type: 'condition',
        field: 'opened_email',
        operator: 'eq',
        value: true,
        true_step: {
          type: 'email',
          subject: '歡迎回來！再加碼送您 NT$200 購物金',
          content:
            '親愛的 {{customer_name}} 您好，\n\n' +
            '很高興看到您回來！🎉\n\n' +
            '為了慶祝您的回歸，我們額外贈送 NT$200 購物金至您的帳戶。\n' +
            '📌 購物金已自動儲值，下次購物時即可折抵。\n\n' +
            '歡迎隨時來選購！\n' +
            '{{company_name}} 團隊 敬上',
        },
        false_step: {
          type: 'sms',
          content:
            '【{{company_name}}】{{customer_name}} 您好，' +
            '我們為您保留了專屬優惠碼 {{reengagement_code}}（8折+免運），' +
            '期限至 {{offer_expiry_date}}，歡迎回來選購！',
        },
      },
    ],
  },

  // ── 生日 VIP 禮遇 ──
  {
    id: 'birthday_vip',
    name: '生日VIP禮遇',
    nameEn: 'Birthday VIP',
    description: '會員生日前後的專屬優惠',
    trigger: 'birthday',
    steps: [
      {
        delay_days: -7,
        delay_hours: 0,
        type: 'email',
        subject: '🎂 {{customer_name}}，生日快樂！專屬好禮搶先送',
        content:
          '親愛的 {{customer_name}} 您好，\n\n' +
          '您的生日即將到來，{{company_name}} 全體同仁提前祝您生日快樂！🎉\n\n' +
          '我們為您準備了專屬的生日 VIP 禮遇：\n\n' +
          '🎁 生日禮金：NT${{birthday_credit}} 購物金（已存入帳戶）\n' +
          '🏷️ 生日折扣碼：{{birthday_code}}（全站 75 折）\n' +
          '🚚 生日免運：整個生日月不限金額免運費\n' +
          '🌟 生日雙倍點數：購物點數加倍累積\n\n' +
          '⏰ 優惠期限：{{birthday_month_start}} ~ {{birthday_month_end}}\n\n' +
          '用最划算的價格犒賞自己吧！\n' +
          '👉 開始選購：{{shop_url}}\n\n' +
          '{{company_name}} 團隊 敬上',
      },
      {
        delay_days: 0,
        delay_hours: 9,
        type: 'line',
        content:
          '🎂🎉 {{customer_name}}，生日快樂！\n\n' +
          '{{company_name}} 祝您生日快樂，天天開心！\n' +
          '您的生日禮金 NT${{birthday_credit}} 已到帳\n' +
          '整個生日月都可以使用喔 🎁',
      },
      {
        delay_days: 0,
        delay_hours: 0,
        type: 'email',
        subject: '🎂 生日快樂，{{customer_name}}！今天是屬於您的特別日子',
        content:
          '親愛的 {{customer_name}} 您好，\n\n' +
          '🎂 祝您生日快樂！🎂\n\n' +
          '今天是屬於您的特別日子，{{company_name}} 衷心祝福您：\n' +
          '新的一歲，一切順心如意！\n\n' +
          '提醒您，以下生日好禮仍可使用：\n' +
          '🎁 NT${{birthday_credit}} 購物金\n' +
          '🏷️ 折扣碼 {{birthday_code}}（75 折）\n' +
          '🚚 不限金額免運費\n\n' +
          '今天買什麼都開心！🎉\n' +
          '👉 選購去：{{shop_url}}\n\n' +
          '{{company_name}} 團隊 敬上',
      },
      {
        delay_days: 7,
        delay_hours: 0,
        type: 'condition',
        field: 'purchased',
        operator: 'eq',
        value: false,
        true_step: {
          type: 'email',
          subject: '感謝您使用生日優惠！期待再次為您服務',
          content:
            '親愛的 {{customer_name}} 您好，\n\n' +
            '感謝您使用了生日優惠，希望您喜歡挑選的商品！\n\n' +
            '別忘了生日月的優惠仍然有效，歡迎繼續選購。\n' +
            '也歡迎推薦好友加入會員，一起享受更多福利！\n\n' +
            '{{company_name}} 團隊 敬上',
        },
        false_step: {
          type: 'email',
          subject: '{{customer_name}}，生日優惠即將到期，把握最後機會！',
          content:
            '親愛的 {{customer_name}} 您好，\n\n' +
            '提醒您，生日專屬優惠即將到期：\n\n' +
            '🎁 NT${{birthday_credit}} 購物金尚未使用\n' +
            '🏷️ 75 折折扣碼 {{birthday_code}} 即將到期\n' +
            '⏰ 最後期限：{{birthday_month_end}}\n\n' +
            '別讓這些好禮浪費了，趕快犒賞自己吧！\n' +
            '👉 立即選購：{{shop_url}}\n\n' +
            '{{company_name}} 團隊 敬上',
        },
      },
    ],
  },

  // ── 產品導引 ──
  {
    id: 'onboarding',
    name: '產品導引',
    nameEn: 'Product Onboarding',
    description: '新用戶產品功能引導序列',
    trigger: 'subscription',
    steps: [
      {
        delay_days: 0,
        delay_hours: 0,
        type: 'email',
        subject: '歡迎使用 {{product_name}}！快速上手指南',
        content:
          '親愛的 {{customer_name}} 您好，\n\n' +
          '恭喜您成功啟用 {{product_name}}！🎉\n\n' +
          '以下是快速上手的三個步驟：\n\n' +
          '📌 步驟一：完成基本設定\n' +
          '登入後台，填寫公司資訊與偏好設定。\n' +
          '👉 前往設定：{{settings_url}}\n\n' +
          '📌 步驟二：匯入您的資料\n' +
          '支援 Excel / CSV 一鍵匯入，快速搬遷無負擔。\n' +
          '👉 匯入工具：{{import_url}}\n\n' +
          '📌 步驟三：邀請團隊成員\n' +
          '邀請同事一起協作，發揮最大效率。\n' +
          '👉 邀請連結：{{invite_url}}\n\n' +
          '如需協助，隨時聯繫我們的專屬客服。\n\n' +
          '{{company_name}} 團隊 敬上',
      },
      {
        delay_days: 2,
        delay_hours: 0,
        type: 'email',
        subject: '{{customer_name}}，來看看 {{product_name}} 最實用的功能！',
        content:
          '親愛的 {{customer_name}} 您好，\n\n' +
          '使用 {{product_name}} 兩天了，以下是其他用戶最推薦的功能：\n\n' +
          '🔥 功能亮點 1：{{feature_highlight_1}}\n' +
          '省下 {{time_saved_1}} 的作業時間，讓您專注在重要的事。\n\n' +
          '🔥 功能亮點 2：{{feature_highlight_2}}\n' +
          '{{feature_benefit_2}}\n\n' +
          '🔥 功能亮點 3：{{feature_highlight_3}}\n' +
          '{{feature_benefit_3}}\n\n' +
          '📺 教學影片：{{tutorial_video_url}}\n' +
          '📖 使用手冊：{{docs_url}}\n\n' +
          '{{company_name}} 團隊 敬上',
      },
      {
        delay_days: 5,
        delay_hours: 0,
        type: 'line',
        content:
          '{{customer_name}} 您好！使用 {{product_name}} 還順利嗎？\n' +
          '如有任何問題，隨時在 LINE 上詢問我們 💬\n' +
          '或預約免費一對一教學：{{booking_url}}',
      },
      {
        delay_days: 7,
        delay_hours: 0,
        type: 'condition',
        field: 'visited_page',
        operator: 'eq',
        value: true,
        true_step: {
          type: 'email',
          subject: '太棒了！您已經是 {{product_name}} 進階使用者 🏆',
          content:
            '親愛的 {{customer_name}} 您好，\n\n' +
            '恭喜您！我們發現您已經熟練使用 {{product_name}} 的核心功能了。🎉\n\n' +
            '想更上一層樓嗎？以下是進階技巧：\n' +
            '🚀 進階功能 1：自動化工作流程\n' +
            '🚀 進階功能 2：自訂報表與儀表板\n' +
            '🚀 進階功能 3：API 串接整合\n\n' +
            '👉 進階教學：{{advanced_tutorial_url}}\n\n' +
            '{{company_name}} 團隊 敬上',
        },
        false_step: {
          type: 'email',
          subject: '{{customer_name}}，需要我們協助您上手嗎？',
          content:
            '親愛的 {{customer_name}} 您好，\n\n' +
            '我們注意到您可能還在摸索 {{product_name}} 的功能，\n' +
            '沒關係，我們提供以下免費資源協助您：\n\n' +
            '📞 免費一對一線上教學（30 分鐘）\n' +
            '👉 預約時段：{{booking_url}}\n\n' +
            '📺 快速入門影片（5 分鐘看完）\n' +
            '👉 觀看影片：{{quickstart_video_url}}\n\n' +
            '💬 即時客服支援\n' +
            '👉 LINE 客服：{{line_support_url}}\n\n' +
            '我們隨時在這裡幫助您！\n' +
            '{{company_name}} 團隊 敬上',
        },
      },
      {
        delay_days: 14,
        delay_hours: 0,
        type: 'email',
        subject: '{{customer_name}}，您的 {{product_name}} 使用報告出爐了 📊',
        content:
          '親愛的 {{customer_name}} 您好，\n\n' +
          '您已使用 {{product_name}} 滿兩週，以下是您的使用摘要：\n\n' +
          '📊 使用統計\n' +
          '• 登入次數：{{login_count}} 次\n' +
          '• 常用功能：{{top_feature}}\n' +
          '• 節省時間：預估約 {{time_saved_total}}\n\n' +
          '🌟 使用建議\n' +
          '根據您的使用習慣，我們建議您也試試 {{suggested_feature}}，\n' +
          '許多類似產業的用戶都覺得非常實用。\n\n' +
          '💡 有任何產品建議或功能許願嗎？歡迎回信告訴我們！\n\n' +
          '{{company_name}} 團隊 敬上',
      },
    ],
  },
]
