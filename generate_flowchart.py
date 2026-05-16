"""Standalone script: render Projects->Workflows->Tasks flowchart as PNG."""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.patches import FancyBboxPatch

C = {
    "cyan":   "#06b6d4",
    "green":  "#22c55e",
    "orange": "#f97316",
    "red":    "#ef4444",
    "purple": "#8b5cf6",
    "blue":   "#3b82f6",
    "gray":   "#334155",
    "text":   "#f1f5f9",
    "muted":  "#94a3b8",
    "bg":     "#0f172a",
    "panel":  "#1e293b",
}

plt.rcParams["font.family"] = ["Microsoft JhengHei", "DejaVu Sans"]

fig, ax = plt.subplots(figsize=(22, 30))
ax.set_xlim(0, 22)
ax.set_ylim(0, 30)
ax.axis("off")
fig.patch.set_facecolor(C["bg"])
ax.set_facecolor(C["bg"])


# ── helpers ──────────────────────────────────────────────────────────────────
def rbox(ax, x, y, w, h, label, color, fontsize=8.5):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.08",
                                facecolor=color, edgecolor="white", linewidth=1.3, zorder=3))
    ax.text(x + w / 2, y + h / 2, label, ha="center", va="center",
            fontsize=fontsize, color="white", fontweight="bold",
            zorder=4, multialignment="center", linespacing=1.4)


def diamond(ax, cx, cy, hw, hh, label, color, fontsize=8.5):
    pts = [(cx, cy + hh), (cx + hw, cy), (cx, cy - hh), (cx - hw, cy)]
    ax.add_patch(plt.Polygon(pts, closed=True, facecolor=color,
                             edgecolor="white", linewidth=1.3, zorder=3))
    ax.text(cx, cy, label, ha="center", va="center", fontsize=fontsize,
            color="white", fontweight="bold", zorder=4, multialignment="center")


def oval(ax, cx, cy, rw, rh, label, color, fontsize=10):
    ax.add_patch(mpatches.Ellipse((cx, cy), rw * 2, rh * 2,
                                  facecolor=color, edgecolor="white",
                                  linewidth=1.8, zorder=3))
    ax.text(cx, cy, label, ha="center", va="center",
            fontsize=fontsize, color="white", fontweight="bold", zorder=4)


def arr(ax, x1, y1, x2, y2, label="", lc=C["muted"], rad=0.0):
    ax.annotate("", xy=(x2, y2), xytext=(x1, y1),
                arrowprops=dict(arrowstyle="-|>", color="white", lw=1.4,
                                connectionstyle=f"arc3,rad={rad}"), zorder=2)
    if label:
        mx, my = (x1 + x2) / 2, (y1 + y2) / 2
        ax.text(mx + 0.12, my, label, fontsize=7.2, color=lc, zorder=5)


def sbg(ax, x, y, w, h, title, color):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.2",
                                facecolor=C["panel"], edgecolor=color,
                                linewidth=2.2, zorder=1, alpha=0.65))
    ax.text(x + 0.35, y + h - 0.25, title, fontsize=10.5, color=color,
            fontweight="bold", va="top", zorder=2)


# ── section backgrounds ───────────────────────────────────────────────────────
sbg(ax,  0.3, 24.5, 21.4,  4.8, "📁  專案層 (Project)",      C["cyan"])
sbg(ax,  0.3, 16.5, 21.4,  7.6, "🔄  工作流程層 (Workflow)",  C["blue"])
sbg(ax,  0.3,  4.5, 21.4, 11.7, "✅  任務層 (Task)",          C["green"])

# ── title ─────────────────────────────────────────────────────────────────────
ax.text(11, 29.4, "專案 → 工作流程 → 任務  流程圖",
        ha="center", fontsize=15, color=C["cyan"], fontweight="bold")

# ── START ─────────────────────────────────────────────────────────────────────
oval(ax, 11, 28.6, 1.5, 0.4, "開 始", C["cyan"], fontsize=11)

# ── PROJECT LAYER ──────────────────────────────────────────────────────────────
rbox(ax,  6.5, 27.2, 9.0, 0.95, "建立專案\n名稱 · 狀態 · 優先級 · 預算 · 負責人", C["cyan"], 8.5)
rbox(ax,  1.0, 25.5, 5.5, 0.85, "新增專案成員\n擁有者 / 管理員 / 成員 / 觀察者", C["gray"], 8)
rbox(ax, 15.5, 25.5, 5.5, 0.85, "建立看板欄位\n待處理 / 進行中 / 已完成", C["gray"], 8)

# ── DECISION: 任務建立方式 ─────────────────────────────────────────────────────
diamond(ax, 11, 23.8, 3.2, 0.85, "任務建立方式?", C["blue"], 9)

# ── WORKFLOW LAYER ─────────────────────────────────────────────────────────────
rbox(ax,  1.2, 21.8, 5.5, 0.9, "選擇 SOP 範本\n分類 · 說明 · 步驟定義",          C["blue"], 8)
rbox(ax,  1.2, 20.4, 5.5, 0.9, "啟動工作流程實例\n綁定 project_id · 指定執行人", C["blue"], 8)
rbox(ax,  1.2, 18.8, 5.5, 1.0, "系統自動展開任務\n依 step_order 排序\nbucket = 工作流程",
     C["blue"], 7.8)

diamond(ax,  8.8, 19.3, 2.5, 0.75, "有審核鏈?", C["blue"], 9)
rbox(ax, 13.0, 18.8, 5.5, 0.9, "掛載審核鏈\napproval_chain_id", C["purple"], 8)

# ── TASK LAYER ─────────────────────────────────────────────────────────────────
rbox(ax,  6.5, 17.0, 9.0, 0.9, "任務建立\n標題 · 指派人 · 截止日 · 優先級", C["green"], 8.5)

# statuses (row)
rbox(ax,  1.0, 14.8, 3.2, 0.8, "待處理",  C["gray"],   9)
rbox(ax,  5.0, 14.8, 3.2, 0.8, "進行中",  C["blue"],   9)
rbox(ax,  9.0, 14.8, 3.2, 0.8, "待簽核",  C["orange"], 9)
rbox(ax, 13.0, 14.8, 3.2, 0.8, "已擱置",  C["red"],    9)
rbox(ax,  5.0, 13.0, 3.2, 0.8, "已完成",  C["green"],  9)

# approval diamond
diamond(ax, 10.6, 12.6, 2.3, 0.72, "審核模式?", C["orange"], 8.5)
rbox(ax,  6.5, 11.0, 4.2, 0.85, "角色審核鏈\nmanager → hr → finance", C["purple"], 8)
rbox(ax, 12.5, 11.0, 4.2, 0.85, "指定人員審核\n逐一確認",              C["purple"], 8)

# post-completion decisions
diamond(ax,  7.5,  9.3, 2.5, 0.72, "有前置依賴?",     C["gray"], 8.5)
rbox(ax,  1.0,  8.8, 4.0, 0.85, "解鎖後續任務\ntask_dependencies", C["cyan"], 8)
diamond(ax, 13.5,  9.3, 2.8, 0.72, "觸發新工作流程?", C["gray"], 8.5)

# progress & final decision
rbox(ax,  5.5,  7.5, 4.5, 0.85, "更新專案進度\nprogress 0–100%", C["cyan"], 8)
diamond(ax, 14.0,  7.9, 2.8, 0.72, "所有任務完成?", C["gray"], 8.5)

# END
oval(ax, 11, 6.2, 1.8, 0.45, "專案完成 ✓", C["green"], fontsize=11)

# ── ARROWS ────────────────────────────────────────────────────────────────────
# start → project
arr(ax, 11, 28.2, 11, 28.15)
arr(ax, 11, 28.15, 11, 27.2)

# project → members/sections
arr(ax, 7.5, 27.2, 3.75, 26.35, "新增成員")
arr(ax, 14.5, 27.2, 18.25, 26.35, "建立欄位")

# project → decision
arr(ax, 11, 27.2, 11, 24.65)

# decision → SOP path
arr(ax, 8.3, 23.5, 3.95, 22.7, "套用 SOP", C["cyan"])
# decision → direct
arr(ax, 13.7, 23.5, 13.7, 17.9, "手動建立", C["muted"])
arr(ax, 13.7, 17.9, 11.0, 17.9)

# SOP chain
arr(ax, 3.95, 21.8, 3.95, 21.3)
arr(ax, 3.95, 20.4, 3.95, 19.8)

# steps → approval diamond
arr(ax, 6.7, 19.3, 6.3, 19.3)
arr(ax, 6.3, 19.3, 6.3, 19.3)
arr(ax, 6.7, 19.3, 8.8, 19.3, "")

# approval diamond → attach chain
arr(ax, 11.3, 19.3, 13.0, 19.3, "是")
arr(ax, 13.0, 19.3, 13.0, 18.8, "")

# approval diamond → task (no)
arr(ax, 8.8, 18.58, 8.8, 17.9, "否")
arr(ax, 8.8, 17.9, 11.0, 17.9)

# attach chain → task
arr(ax, 15.75, 18.8, 15.75, 17.9, "")
arr(ax, 15.75, 17.9, 15.5, 17.9)

# task → statuses
arr(ax, 9.0, 17.0, 2.6, 15.6, "")
arr(ax, 10.0, 17.0, 6.6, 15.6, "")

# status transitions
arr(ax, 4.2, 15.2, 5.0, 15.2, "開始")
arr(ax, 8.2, 15.2, 9.0, 15.2, "需審核")
arr(ax, 8.2, 15.2, 8.2, 13.8, "完成")
arr(ax, 8.2, 13.8, 6.2, 13.8, "")
arr(ax, 8.2, 15.2, 14.6, 15.2, "暫停")
arr(ax, 14.6, 15.2, 14.6, 14.8, "")
arr(ax, 14.6, 14.8, 14.6, 15.6, "重啟", lc=C["red"], rad=-0.35)

# 待簽核 → approval diamond
arr(ax, 10.6, 14.8, 10.6, 13.32)

# approval → chains
arr(ax,  9.0, 12.3, 8.6, 11.85, "角色鏈")
arr(ax, 12.3, 12.3, 12.7, 11.85, "指定人")

# chains → 完成 (approved) / 進行中 (rejected)
arr(ax, 8.6, 11.0, 6.2, 13.8, "批准", lc=C["green"])
arr(ax, 12.7, 11.0, 6.2, 13.8, "批准", lc=C["green"])
arr(ax, 8.6, 11.3, 6.6, 15.2, "退回", lc=C["red"], rad=0.35)
arr(ax, 12.7, 11.3, 8.2, 15.2, "退回", lc=C["red"], rad=-0.35)

# 完成 → 前置依賴
arr(ax, 6.6, 13.0, 7.0, 10.02)
arr(ax, 7.0, 10.02, 7.5, 10.02)

# 前置依賴 → 解鎖
arr(ax, 5.0, 9.3, 3.0, 9.3, "是")
arr(ax, 3.0, 9.3, 3.0, 8.8)

# 解鎖 → 待處理 (loop)
arr(ax, 3.0, 8.8, 2.6, 8.5)
arr(ax, 2.6, 8.5, 2.6, 15.2, "→ 待處理", lc=C["cyan"], rad=0.0)
arr(ax, 2.6, 15.2, 2.6, 15.6)

# 前置依賴 No → 觸發
arr(ax, 10.0, 9.3, 10.7, 9.3, "否")

# 觸發 → SOP (yes loop)
arr(ax, 13.5, 10.02, 13.5, 21.8, "是 → 新 SOP", lc=C["cyan"], rad=0.0)
arr(ax, 13.5, 21.8, 6.7, 21.8)

# 觸發 No → progress
arr(ax, 13.5, 8.58, 13.5, 8.1)
arr(ax, 13.5, 8.1, 10.0, 8.1, "否")

# progress → all done?
arr(ax, 9.5, 7.93, 11.2, 7.93)

# all done yes → END
arr(ax, 14.0, 7.18, 14.0, 6.65)
arr(ax, 14.0, 6.65, 12.8, 6.5, "是")

# all done no → loop back
arr(ax, 11.2, 7.9, 11.2, 4.0, "否", lc=C["muted"], rad=0.0)
arr(ax, 11.2, 4.0, 2.0, 4.0)
arr(ax, 2.0, 4.0, 2.0, 15.2)
arr(ax, 2.0, 15.2, 2.6, 15.2)

# ── LEGEND ────────────────────────────────────────────────────────────────────
legend_items = [
    (C["cyan"],   "起始 / 進度"),
    (C["green"],  "已完成"),
    (C["blue"],   "工作流程"),
    (C["orange"], "待簽核"),
    (C["red"],    "已擱置"),
    (C["purple"], "審核流程"),
    (C["gray"],   "決策 / 一般"),
]
ax.text(16.8, 8.4, "圖例", fontsize=9, color=C["muted"], fontweight="bold")
for i, (col, lbl) in enumerate(legend_items):
    by = 8.0 - i * 0.42
    ax.add_patch(FancyBboxPatch((16.8, by), 0.55, 0.3, boxstyle="round,pad=0.03",
                                facecolor=col, edgecolor="white", linewidth=0.8, zorder=5))
    ax.text(17.45, by + 0.15, lbl, fontsize=7.8, color=C["text"], va="center", zorder=5)

# ── save ──────────────────────────────────────────────────────────────────────
out = "flowchart_projects_workflows_tasks.png"
plt.savefig(out, dpi=150, bbox_inches="tight", facecolor=C["bg"])
print(f"Saved: {out}")
