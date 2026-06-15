-- ════════════════════════════════════════════════════════════════════════════
-- cashout_annual_leave：特休結清聚合 RPC（治本——把前端無 transaction 的批次寫入搬後端）
-- 2026-06-15
--
-- 目的：原本 LeaveBalances.jsx handleCashoutConfirm 用
--   Promise.all(items.map(async => { insert bonus_records; update leave_balances }))
--   → 每人寫兩表、全並行、**無 transaction**：中途任一筆失敗，已送出的不回滾，
--     造成「結清了沒記帳 / 記了帳沒標結清」的半套，錢的帳對不起來。
--   本 RPC 把整批寫入收進單一 function（plpgsql 本體即 atomic）→ 全成或全敗。
--
-- ★ 算法 1:1 對齊前端（openCashout）：
--     unused      = total_days + carry_over_days − used_days   （只取 > 0）
--     daily_rate  = employees.base_salary / 30
--     amount      = round(unused × daily_rate)
--   本薪來源照舊讀 employees.base_salary——已用 _check_basesalary_drift.mjs 實測
--   87 在職員工 emp.base_salary 與 salary_structures.base_salary 零不一致，故金額不變，
--   可逐筆比對舊算法驗證。
--
-- ★ p_dry_run=TRUE（預設）：只回明細不寫，給前端預覽 + 逐筆比對。
--   p_dry_run=FALSE：transaction 內全部 insert+update。
--
-- 防重複：只抓 remaining > 0；結清後 used_days 補滿 → 同年再跑不會重複抓同一人。
--
-- idempotent：CREATE OR REPLACE，無破壞性 DDL。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.cashout_annual_leave(
  p_org     INT,
  p_year    INT,
  p_dry_run BOOLEAN DEFAULT TRUE
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_items json;
  v_count INT     := 0;
  v_total numeric := 0;
  r       RECORD;
BEGIN
  -- 權限 guard：結清會寫入獎金 + 改餘額（錢），且本函式 SECURITY DEFINER 繞 RLS，
  -- 故必須在此擋權限，否則任何 authenticated 直接打 RPC 就能結清全公司特休（提權）。
  -- 白名單 = HR 行政層；store_staff / 無員工身分一律擋。dry_run 也擋（金額也敏感）。
  IF COALESCE(public.current_employee_role(), '') NOT IN ('admin','super_admin','manager','office_staff') THEN
    RAISE EXCEPTION '無權限執行特休結清';
  END IF;

  -- ── 候選明細（特休 + 該年 + 該 org + 尚有剩餘；範圍 1:1 對齊舊前端 openCashout）──
  -- 永遠先算一次（dry_run 與實寫共用同一份 WHERE，確保預覽=實寫範圍）
  SELECT
    COALESCE(json_agg(json_build_object(
      'employee_id', t.employee_id,
      'name',        t.name,
      'balance_id',  t.balance_id,
      'unused_days', t.unused,
      'daily_rate',  t.daily_rate,
      'amount',      t.amount
    ) ORDER BY t.name), '[]'::json),
    COUNT(*),
    COALESCE(SUM(t.amount), 0)
  INTO v_items, v_count, v_total
  FROM (
    SELECT
      lb.id   AS balance_id,
      e.id    AS employee_id,
      e.name,
      (COALESCE(lb.total_days,0) + COALESCE(lb.carry_over_days,0) - COALESCE(lb.used_days,0)) AS unused,
      (COALESCE(e.base_salary,0) / 30.0) AS daily_rate,
      round(
        (COALESCE(lb.total_days,0) + COALESCE(lb.carry_over_days,0) - COALESCE(lb.used_days,0))
        * (COALESCE(e.base_salary,0) / 30.0)
      ) AS amount
    FROM leave_balances lb
    JOIN employees e ON e.id = lb.employee_id
    WHERE lb.leave_type = '特休'
      AND lb.year       = p_year
      AND lb.organization_id = p_org
      AND (COALESCE(lb.total_days,0) + COALESCE(lb.carry_over_days,0) - COALESCE(lb.used_days,0)) > 0
  ) t;

  -- ── 實寫（單一 function = 單一 transaction，任一筆 raise 全回滾）──
  IF NOT p_dry_run THEN
    FOR r IN
      SELECT
        lb.id AS balance_id,
        e.id  AS employee_id,
        (COALESCE(lb.total_days,0) + COALESCE(lb.carry_over_days,0)) AS new_used,
        round(
          (COALESCE(lb.total_days,0) + COALESCE(lb.carry_over_days,0) - COALESCE(lb.used_days,0))
          * (COALESCE(e.base_salary,0) / 30.0)
        ) AS amount
      FROM leave_balances lb
      JOIN employees e ON e.id = lb.employee_id
      WHERE lb.leave_type = '特休'
        AND lb.year       = p_year
        AND e.status      = '在職'
        AND e.organization_id = p_org
        AND (COALESCE(lb.total_days,0) + COALESCE(lb.carry_over_days,0) - COALESCE(lb.used_days,0)) > 0
    LOOP
      INSERT INTO bonus_records(employee_id, category, amount, note, date, organization_id)
      VALUES (r.employee_id, '特休結清', r.amount, '特休結清 ' || p_year, current_date, p_org);

      UPDATE leave_balances SET used_days = r.new_used WHERE id = r.balance_id;
    END LOOP;
  END IF;

  RETURN json_build_object(
    'dry_run',         p_dry_run,
    'processed_count', v_count,
    'total_amount',    v_total,
    'items',           v_items
  );
END $$;

GRANT EXECUTE ON FUNCTION public.cashout_annual_leave(INT, INT, BOOLEAN)
  TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
