// ── Labels ────────────────────────────────────────────────────────────────────

export function priorityLabel(p: string) {
  return ({ low: "🟢低", medium: "🟡中", high: "🔴高", urgent: "🚨緊急" } as Record<string, string>)[p] ?? p;
}

export function statusLabel(s: string) {
  return ({ pending: "待處理", in_progress: "進行中", completed: "已完成", cancelled: "已取消" } as Record<string, string>)[s] ?? s;
}

export const PRIORITY_COLOR: Record<string, string> = {
  low: "#4CAF50", medium: "#E67E22", high: "#E74C3C", urgent: "#8E44AD",
};

export const STATUS_COLOR: Record<string, string> = {
  pending: "#95A5A6", in_progress: "#2980B9", completed: "#27AE60", cancelled: "#7F8C8D",
};
