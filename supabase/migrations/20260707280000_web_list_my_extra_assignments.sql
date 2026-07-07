-- 加簽 (B)：列出「待我會簽的加簽任務」給網頁簽核中心 — 2026-07-07
-- 背景：web_list_my_pending_approval_ids 只算 chain 該我簽的單，沒含加簽任務 →
--       加簽人在網頁「我的簽核」看不到要會簽的單(LINE/LIFF 看得到)。
-- 作法：SECURITY DEFINER RPC，回目前登入者被指派、status=pending 的加簽 + 來源單資訊。
--       ApprovalCenter 前端撈這支，顯示區塊 + inline 核准/退回(process_extra_signer)。

CREATE OR REPLACE FUNCTION public.web_list_my_extra_assignments()
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  emp employees;
BEGIN
  IF v_uid IS NULL THEN RETURN '[]'::json; END IF;
  SELECT * INTO emp FROM employees WHERE auth_user_id = v_uid LIMIT 1;
  IF emp.id IS NULL THEN RETURN '[]'::json; END IF;

  RETURN COALESCE((
    SELECT json_agg(t)
    FROM (
      SELECT e.id, e.source_table, e.source_id, e.insert_before_step,
             e.reason, e.created_at,
             er.name AS requester_name,
             CASE e.source_table
               WHEN 'leave_requests' THEN '請假'
               WHEN 'overtime_requests' THEN '加班'
               WHEN 'business_trips' THEN '出差'
               WHEN 'clock_corrections' THEN '補打卡'
               WHEN 'off_requests' THEN '忘刷/外出'
               WHEN 'personnel_transfer_requests' THEN '人事異動'
               WHEN 'resignation_requests' THEN '離職'
               WHEN 'leave_of_absence_requests' THEN '留停'
               WHEN 'headcount_requests' THEN '人力需求'
               WHEN 'goods_transfer_requests' THEN '商品調撥'
               WHEN 'shift_cover_requests' THEN '換班/代班'
               WHEN 'store_audits' THEN '門市稽核'
               WHEN 'expense_requests' THEN '費用/核銷'
               WHEN 'form_submissions' THEN '自訂表單'
               ELSE e.source_table
             END AS form_label
      FROM approval_extra_steps e
      LEFT JOIN employees er ON er.id = e.requested_by_id
      WHERE e.assignee_id = emp.id AND e.status = 'pending'
      ORDER BY e.created_at DESC
    ) t
  ), '[]'::json);
END $$;

GRANT EXECUTE ON FUNCTION public.web_list_my_extra_assignments() TO authenticated;
NOTIFY pgrst, 'reload schema';
