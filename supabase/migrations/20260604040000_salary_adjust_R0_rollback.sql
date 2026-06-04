-- ════════════════════════════════════════════════════════════════
-- R0 — Rollback：撤掉建錯軌道的 payroll_adjustments 系列物件
--
-- 背景：2026-06-04 上半天誤把薪資調整功能建在 payroll_records / payroll_runs
--      軌道（generate_payroll RPC），但 UI 實際走的是 salary_records 軌道
--     （secure_upsert_salary_v2 RPC）。Phase 0–3 寫的 4 個 migration 已從
--      磁碟刪除（從未 commit），但 DB 物件已建立 → 用此 migration 清掉。
--
-- 純 DROP，撤回前一輪的 6 RPC + recompute helper + 2 表 + 對拍函式。
-- generate_payroll、payroll_runs、payroll_records 都沒動，保留不刪。
-- salary.adjust 權限沿用（R1 還會用到）。
-- ════════════════════════════════════════════════════════════════

BEGIN;

-- ── Phase 3 RPC 套件 ──
DROP FUNCTION IF EXISTS public.save_payroll_adjustment(INT, INT, TEXT, INT, TEXT, JSONB, JSONB, TEXT, INT, INT);
DROP FUNCTION IF EXISTS public.delete_payroll_adjustment(INT);
DROP FUNCTION IF EXISTS public.get_active_payroll_adjustments(INT, INT);
DROP FUNCTION IF EXISTS public.delete_payroll_run(INT);
DROP FUNCTION IF EXISTS public.finalize_payroll_run(INT);
DROP FUNCTION IF EXISTS public.get_payroll_audit_log(CHAR, INT, INT, TEXT, BOOLEAN, INT);

-- ── Phase 2 recompute + helpers ──
DROP FUNCTION IF EXISTS public.recompute_payroll_with_adjustments(INT, INT);
DROP FUNCTION IF EXISTS public._payroll_hourly_rate(INT, INT);
DROP FUNCTION IF EXISTS public._payroll_orig_leave_days(CHAR, INT);

-- ── Phase 0 baseline ──
DROP FUNCTION IF EXISTS public._payroll_baseline_compare(TEXT, CHAR);
DROP FUNCTION IF EXISTS public._payroll_baseline_clear(TEXT);
DROP TABLE    IF EXISTS public._payroll_baseline_snapshots;

-- ── Phase 1 表 ──
DROP TABLE IF EXISTS public.payroll_adjustments;

-- salary.adjust 權限沿用，不刪（R1 用同名 code）

COMMIT;

NOTIFY pgrst, 'reload schema';

DO $$ BEGIN
  RAISE NOTICE 'R0: payroll-track adjustment 系列物件已清除（generate_payroll 等保留不動）';
END $$;
