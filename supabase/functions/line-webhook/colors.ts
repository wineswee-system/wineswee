// ── Color tokens for LINE Flex cards ──────────────────────────────────────────
// 統一色票，所有卡片都從這裡取色，視覺要調整改一處即可。
// 既有 PRIORITY_COLOR / STATUS_COLOR 留在 constants.ts 不動 (legacy palette)。

// ── Brand / semantic header colors ────────────────────────────────────────────
export const COLOR_PRIMARY     = "#2563EB"; // 主品牌藍 — 主選單 / 儀表板 / 一般 LIFF shortcut
export const COLOR_ATTENDANCE  = "#06b6d4"; // 青 — 打卡 / 出勤
export const COLOR_APPROVAL    = "#8b5cf6"; // 紫 — 簽核請求 / 任務確認
export const COLOR_DANGER      = "#dc2626"; // 紅 — 逾期 / 拒絕 / 失敗
export const COLOR_SUCCESS     = "#16a34a"; // 綠 — 核准 / 完成 / 成功
export const COLOR_WARNING     = "#f97316"; // 橘 — 警告 / SLA 逼近
export const COLOR_NEUTRAL     = "#4A4A4A"; // 灰 — 待處理 / 中性
export const COLOR_GOLD        = "#d97706"; // 金 — 薪資 / 獎金
export const COLOR_INFO        = "#0891b2"; // 資訊藍 — 提示 / preview

// 申請類型專屬色（簽核卡用）
export const COLOR_LEAVE       = "#10b981"; // 請假 — 翠綠
export const COLOR_OVERTIME    = "#f59e0b"; // 加班 — 琥珀
export const COLOR_TRIP        = "#3b82f6"; // 出差 — 鈷藍
export const COLOR_EXPENSE     = "#ec4899"; // 經費 — 桃紅
export const COLOR_CORRECTION  = "#8b5cf6"; // 補卡 — 紫
export const COLOR_COVER       = "#06b6d4"; // 代班 — 青
export const COLOR_OFF_REQUEST = "#84cc16"; // 希望休 — 萊姆

// ── Text on colored backgrounds ───────────────────────────────────────────────
export const TEXT_ON_COLOR        = "#FFFFFF";
export const TEXT_ON_COLOR_MUTED  = "#FFFFFFAA";
export const TEXT_ON_COLOR_DIM    = "#FFFFFF99";

// 色彩專屬的「淺色字」(在對應 header 背景上的 subtitle/meta)
export const TEXT_DIM_PRIMARY     = "#BFDBFE";
export const TEXT_DIM_DANGER      = "#FECACA";
export const TEXT_DIM_SUCCESS     = "#BBF7D0";
export const TEXT_DIM_APPROVAL    = "#E9D5FF";
export const TEXT_DIM_ATTENDANCE  = "#CFFAFE";
export const TEXT_DIM_WARNING     = "#FED7AA";
export const TEXT_DIM_GOLD        = "#FEF3C7";
export const TEXT_DIM_LEAVE       = "#A7F3D0";
export const TEXT_DIM_OVERTIME    = "#FDE68A";
export const TEXT_DIM_TRIP        = "#BFDBFE";
export const TEXT_DIM_EXPENSE     = "#FBCFE8";
export const TEXT_DIM_OFF_REQUEST = "#D9F99D";

// ── Body text ─────────────────────────────────────────────────────────────────
export const TEXT_TITLE     = "#111827"; // 主要標題
export const TEXT_BODY      = "#333333"; // 正文
export const TEXT_SECONDARY = "#666666"; // 次要說明
export const TEXT_LABEL     = "#9CA3AF"; // 標籤 (label cell)
export const TEXT_MUTED     = "#CCCCCC"; // 弱化 (短 ID 等)

// ── Tinted backgrounds (light surface for sub-blocks) ─────────────────────────
export const BG_DIM_PRIMARY  = "#EFF6FF";
export const BG_DIM_SUCCESS  = "#ECFDF5";
export const BG_DIM_DANGER   = "#FEF2F2";
export const BG_DIM_WARNING  = "#FFF7ED";
export const BG_DIM_APPROVAL = "#FAF5FF";
export const BG_DIM_NEUTRAL  = "#F3F4F6";
export const BG_DIM_GOLD     = "#FFFBEB";

// ── Convenience: header palette by request type (for P0 approval cards) ──────
export const REQUEST_TYPE_COLORS: Record<string, { header: string; subtitle: string; emoji: string; label: string }> = {
  leave:           { header: COLOR_LEAVE,       subtitle: TEXT_DIM_LEAVE,       emoji: "🏖", label: "請假申請"   },
  overtime:        { header: COLOR_OVERTIME,    subtitle: TEXT_DIM_OVERTIME,    emoji: "⏰", label: "加班申請"   },
  trip:            { header: COLOR_TRIP,        subtitle: TEXT_DIM_TRIP,        emoji: "✈️", label: "出差申請"   },
  expense:         { header: COLOR_EXPENSE,     subtitle: TEXT_DIM_EXPENSE,     emoji: "💰", label: "報帳申請"   },
  expense_request: { header: COLOR_EXPENSE,     subtitle: TEXT_DIM_EXPENSE,     emoji: "💳", label: "經費申請"   },
  correction:      { header: COLOR_CORRECTION,  subtitle: TEXT_DIM_APPROVAL,    emoji: "🔧", label: "補打卡申請" },
  cover:           { header: COLOR_COVER,       subtitle: TEXT_DIM_ATTENDANCE,  emoji: "🔄", label: "代班邀請"   },
  off_request:     { header: COLOR_OFF_REQUEST, subtitle: TEXT_DIM_OFF_REQUEST, emoji: "🌴", label: "希望休申請" },
};
