-- 面試多關:候選人 stage 以「最後一關結果」為準（雙向）— 2026-07-24
-- ════════════════════════════════════════════════════════════════════════════
-- 需求:第一關不過+第二關過 → 過(進待錄取決定);第一關過+第二關不過 → 不過(淘汰)。
-- 舊 trigger _trg_interview_fail_to_dropped:任一關「不通過」就設淘汰,且「通過」無反向 →
--   初試不過先淘汰、複試通過救不回來(測試O724 慘案)。
-- 修法:改成 result 變動時「重算」——取該候選人「最後一關(面試時間最晚,同日取較晚建立)」
--   的定案結果:通過→待錄取決定;不通過→淘汰。只在面試評核階段重算;已進錄取簽核/已錄取
--   /報到後不被面試結果拉回頭(保住錄取簽呈 4 關流程 = 選項B)。函式名沿用(trigger 綁定不動)。
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._trg_interview_fail_to_dropped()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_curr_stage TEXT;
  v_hist       jsonb;
  v_latest     TEXT;   -- 該候選人最後一關的定案結果(通過/不通過)
BEGIN
  IF NEW.result IS NOT DISTINCT FROM OLD.result THEN RETURN NEW; END IF;

  SELECT stage, stage_history INTO v_curr_stage, v_hist
    FROM candidates WHERE id = NEW.candidate_id;
  IF v_curr_stage IS NULL THEN RETURN NEW; END IF;
  -- 只在「面試評核階段」重算;已進錄取簽核/已錄取/報到後不回頭
  IF v_curr_stage NOT IN ('投遞', '篩選中', '面試中', '待錄取決定', '淘汰') THEN RETURN NEW; END IF;

  -- 最後一關 = 面試時間最晚(同日取較晚建立者)的那場「有定案結果」的面試
  SELECT result INTO v_latest
    FROM interviews
   WHERE candidate_id = NEW.candidate_id
     AND result IN ('通過', '不通過')
   ORDER BY scheduled_at DESC NULLS LAST, id DESC
   LIMIT 1;

  IF v_latest = '通過' AND v_curr_stage <> '待錄取決定' THEN
    UPDATE candidates SET
      stage = '待錄取決定',
      stage_history = COALESCE(v_hist, '[]'::jsonb) || jsonb_build_array(
        jsonb_build_object('stage', '待錄取決定', 'changed_at', NOW()::TEXT,
          'reason', '最後一關面試通過'))
     WHERE id = NEW.candidate_id;
  ELSIF v_latest = '不通過' AND v_curr_stage <> '淘汰' THEN
    UPDATE candidates SET
      stage = '淘汰',
      hire_status = NULL,
      stage_history = COALESCE(v_hist, '[]'::jsonb) || jsonb_build_array(
        jsonb_build_object('stage', '淘汰', 'changed_at', NOW()::TEXT,
          'reason', '最後一關面試不通過'))
     WHERE id = NEW.candidate_id;
  END IF;

  RETURN NEW;
EXCEPTION WHEN undefined_table OR undefined_column THEN
  RETURN NEW;
END $$;

-- ── 一次性:修正現存「最後一關結果與 stage 不符」的候選人(例:測試O724 複試通過卻卡淘汰)──
-- idempotent:改完 stage 就不在 WHERE 範圍內,重跑 no-op。
WITH latest AS (
  SELECT DISTINCT ON (candidate_id) candidate_id, result
    FROM interviews
   WHERE result IN ('通過', '不通過')
   ORDER BY candidate_id, scheduled_at DESC NULLS LAST, id DESC
)
UPDATE candidates c SET
  stage = CASE WHEN l.result = '通過' THEN '待錄取決定' ELSE '淘汰' END,
  hire_status = CASE WHEN l.result = '不通過' THEN NULL ELSE c.hire_status END,
  stage_history = COALESCE(c.stage_history, '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object('stage', CASE WHEN l.result = '通過' THEN '待錄取決定' ELSE '淘汰' END,
      'changed_at', NOW()::TEXT, 'reason', '回填:最後一關面試' || l.result))
FROM latest l
WHERE c.id = l.candidate_id
  AND c.stage IN ('面試中', '待錄取決定', '淘汰')
  AND c.stage <> CASE WHEN l.result = '通過' THEN '待錄取決定' ELSE '淘汰' END;

NOTIFY pgrst, 'reload schema';
