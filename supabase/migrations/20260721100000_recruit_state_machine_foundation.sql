-- 招募狀態機 RPC 地基（階段1a）— 2026-07-21
-- 純加法:白名單轉換表 + 引擎 RPC + candidates.employee_id 欄。
-- 不動現有 stage 值、不改前端 → 這支單獨跑不會弄壞招募頁。
-- 狀態值遷移(面試→面試中…)＋前端切換走階段1b 一起上。
--
-- 「多把關」宣告在 recruit_transitions:每條合法轉換帶 requires_permission / is_system。
--   引擎驗 (from,to) 合法性 + 權限 + 阻擋 system-only(只給專用 SECURITY DEFINER RPC 用)。

-- ── 1. 報到綁定用:candidates 加 employee_id ──
ALTER TABLE public.candidates
  ADD COLUMN IF NOT EXISTS employee_id integer REFERENCES public.employees(id) ON DELETE SET NULL;

-- ── 2. 合法轉換白名單(多把關的關卡在這宣告) ──
CREATE TABLE IF NOT EXISTS public.recruit_transitions (
  from_status         text NOT NULL,
  to_status           text NOT NULL,
  requires_permission text,                 -- null=任何 staff;否則需此權限碼(或 admin)
  is_system           boolean NOT NULL DEFAULT false,  -- true=只由專用 RPC 觸發,不開放前端直接手動
  note                text,
  PRIMARY KEY (from_status, to_status)
);

INSERT INTO public.recruit_transitions (from_status, to_status, requires_permission, is_system, note) VALUES
  -- 手動(需 recruit.manage)
  ('投遞',        '篩選中',      'recruit.manage', false, '開始篩選'),
  ('投遞',        '淘汰',        'recruit.manage', false, null),
  ('篩選中',      '面試中',      'recruit.manage', false, '安排面試'),
  ('篩選中',      '淘汰',        'recruit.manage', false, null),
  ('篩選中',      '人才庫',      'recruit.manage', false, '備取'),
  ('面試中',      '待錄取決定',  'recruit.manage', false, '面試通過(亦可由評核 RPC 自動)'),
  ('面試中',      '淘汰',        'recruit.manage', false, null),
  ('面試中',      '人才庫',      'recruit.manage', false, null),
  ('待錄取決定',  '淘汰',        'recruit.manage', false, null),
  ('待錄取決定',  '人才庫',      'recruit.manage', false, null),
  ('錄取簽核中',  '淘汰',        'recruit.manage', false, '撤回錄取'),
  ('已錄取',      '婉拒',        'recruit.manage', false, '候選人拒絕 offer'),
  ('待報到',      '婉拒',        'recruit.manage', false, '報到前反悔'),
  ('淘汰',        '人才庫',      'recruit.manage', false, null),
  ('淘汰',        '篩選中',      'recruit.manage', false, '重啟'),
  ('人才庫',      '篩選中',      'recruit.manage', false, '重啟'),
  ('人才庫',      '面試中',      'recruit.manage', false, '直接約面'),
  ('婉拒',        '人才庫',      'recruit.manage', false, '留才'),
  -- 系統(只由專用 RPC 觸發:建簽呈/推進/報到/連接)
  ('待錄取決定',  '錄取簽核中',  null, true, 'recruit_create_offer'),
  ('錄取簽核中',  '已錄取',      null, true, 'recruit_advance_offer(最終通過)'),
  ('錄取簽核中',  '待錄取決定',  null, true, 'recruit_advance_offer(駁回退回)'),
  ('已錄取',      '待報到',      null, true, 'recruit_onboard(建員工檔)'),
  ('待報到',      '已報到',      null, true, 'recruit_connect(綁 LINE)')
ON CONFLICT (from_status, to_status) DO NOTHING;

-- ── 3. 狀態機引擎(前端/LIFF 共用):驗合法性 + 權限 → 改 stage + 寫軌跡 ──
CREATE OR REPLACE FUNCTION public.recruit_transition(
  p_candidate_id int,
  p_to_status    text,
  p_reason       text DEFAULT NULL
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_from text;
  v_tr   public.recruit_transitions;
BEGIN
  SELECT stage INTO v_from FROM public.candidates WHERE id = p_candidate_id;
  IF v_from IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'CANDIDATE_NOT_FOUND');
  END IF;
  IF v_from = p_to_status THEN
    RETURN json_build_object('ok', true, 'noop', true, 'status', v_from);
  END IF;

  SELECT * INTO v_tr FROM public.recruit_transitions
   WHERE from_status = v_from AND to_status = p_to_status;
  IF v_tr.from_status IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'ILLEGAL_TRANSITION', 'from', v_from, 'to', p_to_status);
  END IF;

  -- 把關(service_role 例外;system 轉換不開放前端直接呼叫)
  IF auth.role() <> 'service_role' THEN
    IF v_tr.is_system THEN
      RETURN json_build_object('ok', false, 'error', 'SYSTEM_ONLY_TRANSITION');
    END IF;
    IF NOT public.is_admin()
       AND v_tr.requires_permission IS NOT NULL
       AND NOT public.current_employee_has_permission(v_tr.requires_permission) THEN
      RETURN json_build_object('ok', false, 'error', 'NO_PERMISSION', 'need', v_tr.requires_permission);
    END IF;
  END IF;

  UPDATE public.candidates
     SET stage = p_to_status,
         stage_history = COALESCE(stage_history::jsonb, '[]'::jsonb)
                         || jsonb_build_object('stage', p_to_status, 'changed_at', now(), 'reason', p_reason),
         updated_at = now()
   WHERE id = p_candidate_id;

  RETURN json_build_object('ok', true, 'from', v_from, 'to', p_to_status);
END $$;

GRANT EXECUTE ON FUNCTION public.recruit_transition(int, text, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
