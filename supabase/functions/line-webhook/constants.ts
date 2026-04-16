export function priorityLabel(p: string) {
  return ({ '低': "🟢低", '中': "🟡中", '高': "🔴高", '緊急': "🚨緊急",
    low: "🟢低", medium: "🟡中", high: "🔴高", urgent: "🚨緊急" } as Record<string, string>)[p] ?? p;
}

export function statusLabel(s: string) {
  return ({ '未開始': "⬜未開始", '進行中': "🔵進行中", '已完成': "✅已完成", '已取消': "❌已取消", '已擱置': "⏸已擱置",
    pending: "⬜待處理", in_progress: "🔵進行中", completed: "✅已完成", cancelled: "❌已取消" } as Record<string, string>)[s] ?? s;
}

export const PRIORITY_COLOR: Record<string, string> = {
  '低': "#4CAF50", '中': "#E67E22", '高': "#E74C3C", '緊急': "#8E44AD",
  low: "#4CAF50", medium: "#E67E22", high: "#E74C3C", urgent: "#8E44AD",
};

export const STATUS_COLOR: Record<string, string> = {
  '未開始': "#95A5A6", '進行中': "#2980B9", '已完成': "#27AE60", '已取消': "#7F8C8D",
  pending: "#95A5A6", in_progress: "#2980B9", completed: "#27AE60", cancelled: "#7F8C8D",
};
