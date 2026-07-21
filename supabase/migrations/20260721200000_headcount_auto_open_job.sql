-- 人力需求單簽核通過 → 自動開缺（階段3-1）— 2026-07-21
-- headcount_requests.status 進入 '已核准'(HR B 鏈最終通過) → 自動建 recruitment_jobs 帶 headcount_request_id。
-- idempotent:同一需求單已有連結職缺就不重開。
-- ⚠️ 現在休眠:目前沒東西會把 headcount 設成「已核准」(前端還用英文 approved),等階段3 前端接上 HR B 鏈才生效。

CREATE OR REPLACE FUNCTION public._trg_headcount_auto_open_job()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = '已核准'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM '已核准') THEN
    -- 已有連此需求單的職缺 → 不重開
    IF NOT EXISTS (SELECT 1 FROM public.recruitment_jobs WHERE headcount_request_id = NEW.id) THEN
      INSERT INTO public.recruitment_jobs
        (title, dept, headcount, status, headcount_request_id, organization_id, posted)
      VALUES
        (COALESCE(NULLIF(NEW.position_title, ''), '未命名職缺'),
         NEW.dept, COALESCE(NEW.headcount, 1), '招募中', NEW.id, NEW.organization_id, CURRENT_DATE);
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_headcount_auto_open_job ON public.headcount_requests;
CREATE TRIGGER trg_headcount_auto_open_job
  AFTER INSERT OR UPDATE OF status ON public.headcount_requests
  FOR EACH ROW EXECUTE FUNCTION public._trg_headcount_auto_open_job();

NOTIFY pgrst, 'reload schema';
