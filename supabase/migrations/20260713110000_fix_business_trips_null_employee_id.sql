-- 出差申請 employee_id NULL 修復 — 2026-07-13
-- 症狀:剛送的出差單「系統看不到 + 簽核鏈沒吃對」。
-- 根因:前端建單沒帶 employee_id(只填 employee 姓名) → business_trips.employee_id = NULL。
--   ① 可見性:六月 RLS 收斂把 business_trips SELECT 改成 can_see_request(employee_id),
--      而 can_see_request 內「applicant_id IS NULL → RETURN false」發生在 is_admin() 檢查之前,
--      所以 employee_id NULL 時連 admin 都被擋 → 整頁空白。
--   ② 簽核鏈:_auto_apply_hr_form_chain 用 NEW.employee_id 判 applicant_type,NULL → 解不出
--      是不是部門主管 → 掉到預設 'staff' 鏈。實際 #6(張庭瑋)/#7(侯承寯)都是部門主管 → 應走 'manager' 鏈。
-- 做法:純資料修 + 重建 snapshot,idempotent、可重跑。前端已同步改成建單一定帶 employee_id(根治)。

-- ① 從姓名回填 employee_id(同組、在職優先)
UPDATE public.business_trips bt
SET employee_id = e.id
FROM public.employees e
WHERE bt.employee_id IS NULL
  AND e.name = bt.employee
  AND (e.organization_id = bt.organization_id OR bt.organization_id IS NULL)
  AND e.status = '在職';

-- ② 重解「待審核 + 尚未有人簽(step 0)」單據的簽核鏈:
--    employee_id 補回後重新判 applicant_type,若正確鏈與現行不同 → 換鏈並重建 snapshot。
--    snapshot 觸發器是 AFTER INSERT-only,UPDATE 不會重觸發,故先刪舊 snapshot 再手動重建。
DO $$
DECLARE
  r        RECORD;
  v_atype  TEXT;
  v_chain  INT;
  v_store  INT;
  v_stype  TEXT;
BEGIN
  FOR r IN
    SELECT id, employee_id, organization_id, approval_chain_id
    FROM public.business_trips
    WHERE status = '待審核'
      AND COALESCE(current_step, 0) = 0
      AND employee_id IS NOT NULL
  LOOP
    -- applicant_type:比照 _auto_apply_hr_form_chain(部門主管 > 門市員工 > 一般員工)
    IF EXISTS (SELECT 1 FROM public.departments WHERE manager_id = r.employee_id) THEN
      v_atype := 'manager';
    ELSE
      SELECT e.store_id, s.store_type INTO v_store, v_stype
      FROM public.employees e
      LEFT JOIN public.stores s ON s.id = e.store_id
      WHERE e.id = r.employee_id;
      IF v_store IS NOT NULL AND v_stype = 'retail' THEN
        v_atype := 'store_staff';
      ELSE
        v_atype := 'staff';
      END IF;
    END IF;

    -- 對應鏈:先找該 applicant_type 的設定,沒有再退回 'all'
    SELECT chain_id INTO v_chain
    FROM public.form_chain_configs
    WHERE form_type = 'trip' AND is_active
      AND organization_id = r.organization_id
      AND applicant_type = v_atype
    LIMIT 1;
    IF v_chain IS NULL THEN
      SELECT chain_id INTO v_chain
      FROM public.form_chain_configs
      WHERE form_type = 'trip' AND is_active
        AND organization_id = r.organization_id
        AND applicant_type = 'all'
      LIMIT 1;
    END IF;

    -- 只在鏈需要更正時才動(避免無謂重建)
    IF v_chain IS NOT NULL AND v_chain IS DISTINCT FROM r.approval_chain_id THEN
      DELETE FROM public.request_chain_snapshots
      WHERE request_type = 'trip' AND request_id = r.id;

      UPDATE public.business_trips
      SET approval_chain_id = v_chain, current_step = 0
      WHERE id = r.id;

      PERFORM public._snapshot_chain_for_request('trip', r.id, v_chain, r.employee_id);
    END IF;
  END LOOP;
END $$;
