-- =============================================
-- 法令更新提醒 — 每年 12/1 自動寄通知給 admin
-- 用 pg_cron 排程；通知透過 notifications 表
-- =============================================

BEGIN;

-- ── Function: 寄出年度法令更新提醒 ──
CREATE OR REPLACE FUNCTION public.send_yearly_law_update_reminder()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next_year INT := EXTRACT(YEAR FROM (now() + INTERVAL '1 month'))::INT;
  v_count     INT := 0;
  rec         RECORD;
BEGIN
  FOR rec IN
    SELECT id FROM employees
    WHERE status = '在職' AND role IN ('super_admin','admin')
  LOOP
    INSERT INTO notifications (
      type, title, recipient_emp_id, organization_id, payload, read
    ) VALUES (
      'law_update_reminder',
      format('📋 該更新 %s 年度法令級距了', v_next_year),
      rec.id,
      1,
      jsonb_build_object(
        'next_year', v_next_year,
        'links', jsonb_build_array(
          jsonb_build_object('label', '勞保級距', 'url', 'https://www.bli.gov.tw/0014162.html'),
          jsonb_build_object('label', '健保級距', 'url', 'https://www.nhi.gov.tw/'),
          jsonb_build_object('label', '所得稅扣繳', 'url', 'https://www.dot.gov.tw/'),
          jsonb_build_object('label', '基本工資', 'url', 'https://www.mol.gov.tw/')
        ),
        'action_url', '/hr/labor-law-rates',
        'message', format('政府通常會在 11–12 月公布隔年的勞健保級距、所得稅扣繳級距、基本工資。請在 %s-01-01 生效前完成匯入。', v_next_year)
      ),
      false
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.send_yearly_law_update_reminder IS
  '每年 12/1 由 pg_cron 觸發，寄通知給所有在職 admin / super_admin 提醒更新隔年法令';

-- ── 排程：每年 12/1 09:00 ──
DO $$
BEGIN
  -- 移除舊排程（如有）
  PERFORM cron.unschedule('yearly_law_update_reminder');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'yearly_law_update_reminder',
  '0 9 1 12 *',                                  -- 每年 12/1 09:00
  $$SELECT public.send_yearly_law_update_reminder();$$
);

COMMIT;
