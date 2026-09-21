-- ============================================================
-- 20260705160000_invoice_track_allocations.sql
-- F-B2 字軌配號管理（PLAN_fin-tax-inv_2026-07-04 二/F-B2）
--
-- 1. invoice_track_allocations — 字軌配號區間（財政部配號檔匯入或手動建期別）
-- 2. allocate_invoice_number() 升級（CREATE OR REPLACE，保留原簽名與 row-lock 語意）：
--    配號後檢查號碼必須落在 active 配號區間內；區間外/用罄 → RAISE 'TRACK_EXHAUSTED'。
--    ★ Grandfather mode（向下相容）：該 (org, period, track) 完全沒有配號區間列時，
--      行為與舊版一致（僅上限 99999999），現行 mock 開立流程不受影響。
-- 3. get_track_usage(p_org) — 各期別/字軌的區間、已用、餘量、餘量百分比（UI 餘量警示用）
--
-- 冪等：可重複執行。
-- ============================================================

-- ═══ 1. 字軌配號區間表 ═══

CREATE TABLE IF NOT EXISTS public.invoice_track_allocations (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id BIGINT      NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- 期別 YYYYMM（INT），雙月一期取奇數月 — 與 invoice_number_sequences.period（TEXT）同一慣例
  period          INT         NOT NULL CHECK (period % 100 IN (1, 3, 5, 7, 9, 11)),
  track           CHAR(2)     NOT NULL CHECK (track ~ '^[A-Z]{2}$'),
  range_start     BIGINT      NOT NULL CHECK (range_start >= 0),
  range_end       BIGINT      NOT NULL CHECK (range_end <= 99999999),
  source          TEXT        NOT NULL DEFAULT 'manual' CHECK (source IN ('config', 'manual')),
  status          TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'exhausted', 'closed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (range_end >= range_start),
  UNIQUE (organization_id, period, track, range_start)
);

COMMENT ON TABLE public.invoice_track_allocations IS
  '字軌配號區間（F-B2）：source=config 財政部配號檔匯入 / manual 手動建期別；配號 RPC 僅允許 active 區間內取號';

CREATE INDEX IF NOT EXISTS invoice_track_allocations_org_period_idx
  ON public.invoice_track_allocations (organization_id, period, track);

-- ═══ 2. allocate_invoice_number() 升級 ═══
-- 保留原簽名（20260702610000）：(p_org_id BIGINT, p_period TEXT, p_track TEXT) RETURNS BIGINT
-- row-lock 語意：SELECT ... FOR UPDATE 鎖住配號列 → 計算下一號 → 單次 UPDATE 寫回，
-- 同一交易內序列化，併發不重號（等價於原版 UPDATE ... RETURNING）。

CREATE OR REPLACE FUNCTION public.allocate_invoice_number(
  p_org_id BIGINT,
  p_period TEXT,
  p_track  TEXT DEFAULT 'AB'
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last      BIGINT;
  v_next      BIGINT;
  v_alloc     public.invoice_track_allocations%ROWTYPE;
  v_has_alloc BOOLEAN;
BEGIN
  IF p_track !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION '字軌必須為 2 碼大寫英文字母';
  END IF;
  IF p_period !~ '^\d{6}$' THEN
    RAISE EXCEPTION '期別格式錯誤（應為 YYYYMM）';
  END IF;

  -- 首次使用該期別/字軌時建立配號列
  INSERT INTO invoice_number_sequences (organization_id, period, track)
  VALUES (p_org_id, p_period, p_track)
  ON CONFLICT (organization_id, period, track) DO NOTHING;

  -- row lock：併發配號時序列化
  SELECT next_number INTO v_last
    FROM invoice_number_sequences
   WHERE organization_id = p_org_id
     AND period = p_period
     AND track  = p_track
   FOR UPDATE;

  v_next := v_last + 1;

  SELECT EXISTS (
    SELECT 1 FROM invoice_track_allocations
     WHERE organization_id = p_org_id
       AND period = p_period::INT
       AND track  = p_track
  ) INTO v_has_alloc;

  IF NOT v_has_alloc THEN
    -- ★ Grandfather mode：尚未建立任何配號區間 → 沿用舊版行為（向下相容，
    --   現行 mock 開立流程不需先建區間即可配號）
    IF v_next > 99999999 THEN
      RAISE EXCEPTION '期別 % 字軌 % 號碼已用罄', p_period, p_track;
    END IF;
  ELSE
    -- 已越過的 active 區間標記 exhausted（例：手動跳號後遺留的舊區間）
    UPDATE invoice_track_allocations
       SET status = 'exhausted'
     WHERE organization_id = p_org_id
       AND period = p_period::INT
       AND track  = p_track
       AND status = 'active'
       AND range_end < v_next;

    -- 取 v_next 所在（或其後最近）的 active 區間
    SELECT * INTO v_alloc
      FROM invoice_track_allocations
     WHERE organization_id = p_org_id
       AND period = p_period::INT
       AND track  = p_track
       AND status = 'active'
       AND range_end >= v_next
     ORDER BY range_start
     LIMIT 1;

    IF NOT FOUND THEN
      -- 明確錯誤碼：前端/edge function 以訊息前綴 TRACK_EXHAUSTED 判斷
      RAISE EXCEPTION 'TRACK_EXHAUSTED：期別 % 字軌 % 配號區間已用罄，請匯入或新增配號區間', p_period, p_track;
    END IF;

    -- 落在區間前的空洞 → 跳到區間起號
    IF v_next < v_alloc.range_start THEN
      v_next := v_alloc.range_start;
    END IF;

    -- 配出末號 → 該區間標記 exhausted
    IF v_next = v_alloc.range_end THEN
      UPDATE invoice_track_allocations SET status = 'exhausted' WHERE id = v_alloc.id;
    END IF;
  END IF;

  UPDATE invoice_number_sequences
     SET next_number = v_next,
         updated_at  = NOW()
   WHERE organization_id = p_org_id
     AND period = p_period
     AND track  = p_track;

  RETURN v_next;
END;
$$;

-- 配號僅允許 service role（edge function issue-invoice）— 與原版一致
REVOKE ALL ON FUNCTION public.allocate_invoice_number(BIGINT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.allocate_invoice_number(BIGINT, TEXT, TEXT) FROM anon, authenticated;

-- ═══ 3. get_track_usage：各期別/字軌用量（UI 餘量警示）═══
-- SECURITY INVOKER：依 RLS 只能看見自己組織的區間與配號列。

CREATE OR REPLACE FUNCTION public.get_track_usage(p_org BIGINT)
RETURNS TABLE (
  allocation_id UUID,
  period        INT,
  track         TEXT,
  range_start   BIGINT,
  range_end     BIGINT,
  source        TEXT,
  status        TEXT,
  total         BIGINT,
  used          BIGINT,
  remaining     BIGINT,
  pct_remaining NUMERIC
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    a.id                                   AS allocation_id,
    a.period,
    a.track::TEXT                          AS track,
    a.range_start,
    a.range_end,
    a.source,
    a.status,
    (a.range_end - a.range_start + 1)      AS total,
    -- next_number = 最後配出的號碼 → 區間內已用 = clamp(next_number − range_start + 1, 0, total)
    LEAST(
      GREATEST(COALESCE(s.next_number, 0) - a.range_start + 1, 0),
      a.range_end - a.range_start + 1
    )                                      AS used,
    (a.range_end - a.range_start + 1) - LEAST(
      GREATEST(COALESCE(s.next_number, 0) - a.range_start + 1, 0),
      a.range_end - a.range_start + 1
    )                                      AS remaining,
    ROUND(
      100.0 * ((a.range_end - a.range_start + 1) - LEAST(
        GREATEST(COALESCE(s.next_number, 0) - a.range_start + 1, 0),
        a.range_end - a.range_start + 1
      )) / (a.range_end - a.range_start + 1),
      1
    )                                      AS pct_remaining
  FROM invoice_track_allocations a
  LEFT JOIN invoice_number_sequences s
    ON s.organization_id = a.organization_id
   AND s.period = a.period::TEXT
   AND s.track  = a.track
  WHERE a.organization_id = p_org
  ORDER BY a.period DESC, a.track, a.range_start;
$$;

REVOKE ALL ON FUNCTION public.get_track_usage(BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_track_usage(BIGINT) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_track_usage(BIGINT) TO authenticated, service_role;

-- ═══ 4. RLS（沿用 org_visible 模式，同 20260705120000）═══

ALTER TABLE public.invoice_track_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invoice_track_allocations_sel ON public.invoice_track_allocations;
CREATE POLICY invoice_track_allocations_sel ON public.invoice_track_allocations
  FOR SELECT TO authenticated
  USING (org_visible(organization_id));

-- 手動建期別/匯入配號檔：org 內可寫（配號消耗一律走 SECURITY DEFINER RPC）
DROP POLICY IF EXISTS invoice_track_allocations_ins ON public.invoice_track_allocations;
CREATE POLICY invoice_track_allocations_ins ON public.invoice_track_allocations
  FOR INSERT TO authenticated
  WITH CHECK (org_visible(organization_id));

DROP POLICY IF EXISTS invoice_track_allocations_upd ON public.invoice_track_allocations;
CREATE POLICY invoice_track_allocations_upd ON public.invoice_track_allocations
  FOR UPDATE TO authenticated
  USING (org_visible(organization_id))
  WITH CHECK (org_visible(organization_id));

DROP POLICY IF EXISTS invoice_track_allocations_del ON public.invoice_track_allocations;
CREATE POLICY invoice_track_allocations_del ON public.invoice_track_allocations
  FOR DELETE TO authenticated
  USING (org_visible(organization_id));

NOTIFY pgrst, 'reload schema';
