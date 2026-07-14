-- 職位（職稱）主檔 + 管理 RPC — 2026-07-14
-- 原本職位寫死在前端(HrTabContent.POSITION_OPTS / EmployeeFormModal.POSITIONS),要加就得改 code。
-- 改成資料表 + 後台可自編。category=顯示分組(管理職/行政職/門市職);level=系統角色對應
--   (admin→role2 / manager→3 / office_staff→4 / store_staff→5,新進員工沒手動指定角色時用它 fallback)。
-- 讀:list_positions(全員);寫:upsert/delete 走 SECURITY DEFINER + is_admin() 擋。idempotent。

CREATE TABLE IF NOT EXISTS public.positions (
  id              serial PRIMARY KEY,
  organization_id int  NOT NULL DEFAULT 1,
  category        text NOT NULL DEFAULT '其他',        -- 顯示分組
  label           text NOT NULL,                        -- 職稱
  level           text NOT NULL DEFAULT 'store_staff'   -- RBAC 角色對應
                    CHECK (level IN ('admin','manager','office_staff','store_staff')),
  sort_order      int  NOT NULL DEFAULT 100,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  UNIQUE (organization_id, label)
);
CREATE INDEX IF NOT EXISTS idx_positions_org ON public.positions (organization_id, is_active, sort_order);

-- ── seed(僅在 label 不存在時插入,不覆寫既有) ──
INSERT INTO public.positions (organization_id, category, label, level, sort_order) VALUES
  (1,'管理職','總經理','admin',10),(1,'管理職','副總經理','admin',20),(1,'管理職','執行長','admin',30),
  (1,'管理職','總監','manager',40),(1,'管理職','經理','manager',50),(1,'管理職','企劃經理','manager',55),
  (1,'管理職','副理','manager',60),(1,'管理職','主管','manager',70),(1,'管理職','副主管','manager',80),
  (1,'管理職','店長','manager',90),(1,'管理職','副店長','manager',100),(1,'管理職','資深店長','manager',110),
  (1,'管理職','督導','manager',120),(1,'管理職','組長','manager',130),(1,'管理職','主任','manager',140),
  (1,'行政職','資深工程師','office_staff',210),(1,'行政職','工程師','office_staff',220),(1,'行政職','專員','office_staff',230),
  (1,'行政職','行政助理','office_staff',240),(1,'行政職','會計','office_staff',250),
  (1,'行政職','儲備幹部','store_staff',260),(1,'行政職','業務代表','store_staff',270),
  (1,'門市職','門市人員','store_staff',310),(1,'門市職','門市正職人員','store_staff',320),(1,'門市職','門市兼職人員','store_staff',330),
  (1,'門市職','正職人員','store_staff',340),(1,'門市職','兼職人員','store_staff',350),(1,'門市職','收銀員','store_staff',360),
  (1,'門市職','倉管人員','store_staff',370),(1,'門市職','助理','store_staff',380),(1,'門市職','實習生','store_staff',390)
ON CONFLICT (organization_id, label) DO NOTHING;

-- ── RLS:讀走 RPC,直查也放行在職員工;寫全走 RPC ──
ALTER TABLE public.positions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS positions_select ON public.positions;
CREATE POLICY positions_select ON public.positions FOR SELECT USING (public.is_staff());

-- ── 讀:list_positions ──
CREATE OR REPLACE FUNCTION public.list_positions(p_include_inactive boolean DEFAULT false)
RETURNS SETOF public.positions LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.positions
  WHERE organization_id = COALESCE((SELECT organization_id FROM public.employees WHERE id = public.current_employee_id()), 1)
    AND (p_include_inactive OR is_active)
  ORDER BY sort_order, id;
$$;

-- ── 寫①:新增/更新(id 為 NULL → 新增) ──
CREATE OR REPLACE FUNCTION public.upsert_position(
  p_id int, p_category text, p_label text, p_level text,
  p_sort_order int DEFAULT NULL, p_is_active boolean DEFAULT true
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org int; v_id int;
BEGIN
  IF NOT public.is_admin() THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHORIZED'); END IF;
  IF COALESCE(btrim(p_label),'') = '' THEN RETURN json_build_object('ok', false, 'error', 'MISSING_LABEL'); END IF;
  IF p_level NOT IN ('admin','manager','office_staff','store_staff') THEN
    RETURN json_build_object('ok', false, 'error', 'BAD_LEVEL'); END IF;
  v_org := COALESCE((SELECT organization_id FROM public.employees WHERE id = public.current_employee_id()), 1);

  IF p_id IS NULL THEN
    INSERT INTO public.positions (organization_id, category, label, level, sort_order, is_active)
    VALUES (v_org, COALESCE(NULLIF(btrim(p_category),''),'其他'), btrim(p_label), p_level,
            COALESCE(p_sort_order, 100), COALESCE(p_is_active, true))
    ON CONFLICT (organization_id, label) DO UPDATE
      SET category = EXCLUDED.category, level = EXCLUDED.level,
          sort_order = EXCLUDED.sort_order, is_active = EXCLUDED.is_active, updated_at = now()
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.positions
       SET category = COALESCE(NULLIF(btrim(p_category),''),'其他'), label = btrim(p_label), level = p_level,
           sort_order = COALESCE(p_sort_order, sort_order), is_active = COALESCE(p_is_active, is_active), updated_at = now()
     WHERE id = p_id AND organization_id = v_org
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  END IF;
  RETURN json_build_object('ok', true, 'id', v_id);
END $$;

-- ── 寫②:刪除 ──
CREATE OR REPLACE FUNCTION public.delete_position(p_id int)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org int;
BEGIN
  IF NOT public.is_admin() THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHORIZED'); END IF;
  v_org := COALESCE((SELECT organization_id FROM public.employees WHERE id = public.current_employee_id()), 1);
  DELETE FROM public.positions WHERE id = p_id AND organization_id = v_org;
  RETURN json_build_object('ok', true);
END $$;

GRANT EXECUTE ON FUNCTION public.list_positions(boolean)               TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_position(int,text,text,text,int,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_position(int)                  TO authenticated;
NOTIFY pgrst, 'reload schema';
