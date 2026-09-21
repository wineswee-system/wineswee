-- 修:notification_quiet_queue 開了 RLS 卻零政策 → 前端(lineNotify.js)靜音時段入列被 42501 擋掉 → 卡片消失。
-- 補登入員工 INSERT 政策(不開 anon、不用 true);清佇列走 task-reminder(service_role,不受 RLS 影響)。

DROP POLICY IF EXISTS nqq_staff_insert ON public.notification_quiet_queue;
CREATE POLICY nqq_staff_insert ON public.notification_quiet_queue
  FOR INSERT TO authenticated WITH CHECK (public.is_staff());
