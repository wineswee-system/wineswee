-- 修 招募:安排面試後候選人從看板消失 — 2026-07-23
-- ────────────────────────────────────────────────────────────────────────────
-- 病灶:舊 trigger _trg_interview_advance_to_face(interviews INSERT)把候選人 stage
--   寫成 '面試'(且 guard 檢查 '篩選')。這是 2026-05-24 舊命名;老闆 07-21 建 11 態
--   狀態機後全改用 '面試中'/'篩選中'(對齊 recruit_transitions),但這支 trigger 漏改。
--   → 一安排面試,stage 被寫成看板 8 欄(STAGES)不認得的 '面試' → 候選人從看板消失,
--     但仍計入「共 N 位」。07-21 的值遷移只清了當下 2 筆,trigger 之後又寫回壞值(測試123)。
-- 修法:
--   1) 根因:trigger 改寫 '面試中'、guard 納入 '篩選中'(對齊狀態機),與值遷移映射一致。
--   2) 資料:把現存 '面試'→'面試中'、'篩選'→'篩選中'(idempotent,救回消失的候選人)。
-- 影響:trigger 僅此一處定義、無其他引用;安排面試走 createInterview→INSERT interviews→
--   本 trigger,無其他設 stage 路徑。低風險。

-- ── 1) 根因:trigger 改用狀態機的正規 stage 值 ──────────────────────────────
CREATE OR REPLACE FUNCTION public._trg_interview_advance_to_face()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_curr_stage TEXT;
  v_hist       jsonb;
BEGIN
  SELECT stage, stage_history INTO v_curr_stage, v_hist
    FROM candidates WHERE id = NEW.candidate_id;
  IF v_curr_stage IS NULL THEN RETURN NEW; END IF;

  -- 投遞/篩選中(含舊值篩選)→ 安排面試自動推進到「面試中」(對齊 11 態狀態機)
  IF v_curr_stage IN ('投遞', '篩選', '篩選中') THEN
    UPDATE candidates SET
      stage = '面試中',
      stage_history = COALESCE(v_hist, '[]'::jsonb) || jsonb_build_array(
        jsonb_build_object('stage', '面試中', 'changed_at', NOW()::TEXT, 'reason', '安排面試自動推進')
      )
     WHERE id = NEW.candidate_id;
  END IF;

  RETURN NEW;
EXCEPTION WHEN undefined_table OR undefined_column THEN
  RETURN NEW;
END $$;

-- trigger 綁定不變(已存在),不重建以免動到現有掛載

-- ── 2) 資料:把 trigger 之前寫壞的舊值收斂成正規值(對齊 20260721110000 映射) ──
UPDATE public.candidates SET stage = '面試中' WHERE stage = '面試';
UPDATE public.candidates SET stage = '篩選中' WHERE stage = '篩選';

-- stage_history 內殘留的 '面試'/'篩選' 標籤一併正規化(僅精確 JSON 字串,不誤傷 reason 內文字)
UPDATE public.candidates
   SET stage_history = replace(replace(stage_history::text, '"面試"', '"面試中"'), '"篩選"', '"篩選中"')::jsonb
 WHERE stage_history::text LIKE '%"面試"%' OR stage_history::text LIKE '%"篩選"%';

NOTIFY pgrst, 'reload schema';
