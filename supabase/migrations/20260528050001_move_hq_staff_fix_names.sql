-- 補修：名字拼法跟 migration 050000 不同而漏掉的 2 人
--   李英顥（顥，非顯）
--   陳佩璇 Alicia（璇，非瑢）

BEGIN;

UPDATE public.employees
SET store_id = 20
WHERE name IN ('李英顥', '陳佩璇');

-- 驗證
DO $$
DECLARE v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count FROM public.employees
  WHERE name IN ('李英顥', '陳佩璇') AND store_id = 20;
  RAISE NOTICE 'OK：補修 % 人 → 威士威企業總部', v_count;
END $$;

COMMIT;
