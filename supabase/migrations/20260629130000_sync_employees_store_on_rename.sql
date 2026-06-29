-- 門市改名時，自動把 employees.store 文字欄同步更新
-- idempotent

CREATE OR REPLACE FUNCTION public.tg_cascade_store_name_to_employees()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE public.employees
    SET    store = NEW.name
    WHERE  store_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_cascade_store_name_to_employees ON public.stores;
CREATE TRIGGER trg_cascade_store_name_to_employees
  AFTER UPDATE OF name ON public.stores
  FOR EACH ROW EXECUTE FUNCTION public.tg_cascade_store_name_to_employees();
