-- 被加簽人核准/退回時可留備註(processor_note),供發起加簽的下一關簽核人看到其判斷。
-- 例:陳虹(執行長)加簽找林盟傑先看金額 → 林盟傑核准+備註「金額合理」→ 回到陳虹複核時看得到。
ALTER TABLE public.approval_extra_steps ADD COLUMN IF NOT EXISTS processor_note text;

-- 加參數 p_note:PG 不能靠 CREATE OR REPLACE 改簽名 → 先 DROP 舊 4 參數版再建 5 參數版(避免 overload 歧義)。
DROP FUNCTION IF EXISTS public.process_extra_signer(integer, integer, text, text);

CREATE OR REPLACE FUNCTION public.process_extra_signer(
  p_extra_step_id integer,
  p_processor_id integer,
  p_action text,
  p_reject_reason text DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS approval_extra_steps
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_extra public.approval_extra_steps;
BEGIN
  SELECT * INTO v_extra
  FROM public.approval_extra_steps
  WHERE id = p_extra_step_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '加簽紀錄不存在（id=%）', p_extra_step_id USING ERRCODE = '22023';
  END IF;

  IF v_extra.status <> 'pending' THEN
    RAISE EXCEPTION '加簽狀態非 pending（目前=%），無法處理', v_extra.status USING ERRCODE = '22023';
  END IF;

  IF v_extra.assignee_id <> p_processor_id THEN
    RAISE EXCEPTION '只有加簽人本人可以處理（assignee=%，processor=%）',
      v_extra.assignee_id, p_processor_id USING ERRCODE = '42501';
  END IF;

  IF p_action = 'approve' THEN
    UPDATE public.approval_extra_steps
    SET status = 'approved', approved_at = now(),
        processor_note = NULLIF(trim(p_note), '')
    WHERE id = p_extra_step_id
    RETURNING * INTO v_extra;

  ELSIF p_action = 'reject' THEN
    IF p_reject_reason IS NULL OR length(trim(p_reject_reason)) = 0 THEN
      RAISE EXCEPTION '退回必須填原因' USING ERRCODE = '22023';
    END IF;
    UPDATE public.approval_extra_steps
    SET status = 'rejected', reject_reason = p_reject_reason,
        processor_note = NULLIF(trim(p_note), '')
    WHERE id = p_extra_step_id
    RETURNING * INTO v_extra;

  ELSE
    RAISE EXCEPTION '無效的 action：%（必須是 approve 或 reject）', p_action USING ERRCODE = '22023';
  END IF;

  RETURN v_extra;
END
$function$;
