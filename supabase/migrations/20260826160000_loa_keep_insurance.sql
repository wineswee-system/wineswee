-- 留職停薪表單加「續保/退保」:留停期間勞健保續不續保。預設 true(續保)。
ALTER TABLE public.leave_of_absence_requests ADD COLUMN IF NOT EXISTS keep_insurance boolean NOT NULL DEFAULT true;
