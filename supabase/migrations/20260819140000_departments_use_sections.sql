-- 部門可設定「是否啟用課級(督導層)」— 2026-08-19
-- SaaS:不同公司有無督導/課那層不同 → 加開關。false = 組織圖把門市直接攤平掛部門,不畫課/督導。
ALTER TABLE public.departments ADD COLUMN IF NOT EXISTS use_sections boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN public.departments.use_sections IS '是否啟用課級(督導層):false→組織圖直接把門市攤平掛部門,不畫課/督導';
NOTIFY pgrst, 'reload schema';
