-- ════════════════════════════════════════════════════════════════════════════
-- 收款 v4：分期/訂金「不准超收」守門
-- 2026-08-06
--
-- 問題：加盟金每期可分多筆，但沒擋超收 → 某期收超過目標(如第一期目標 90萬
--   卻收 100萬)，多的 10萬「沒被該期吃掉」卻仍被母單總額算進去 → 數字對不上。
-- 修法：BEFORE INSERT 守門，任一期(或訂金)收款加總不得超過該期目標/訂金目標；
--   超過直接 RAISE，前端提示「本期最多再收 X」。分期記錄維持完整、總額必正確。
-- idempotent。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- 加盟金：每期不得超過「該投資人分攤額 × 該期比例」
CREATE OR REPLACE FUNCTION public.tg_ff_payment_cap()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_amt NUMERIC; v_t1 NUMERIC; v_t2 NUMERIC; v_target NUMERIC; v_paid NUMERIC;
BEGIN
  SELECT amount INTO v_amt FROM franchise_fee_investors
   WHERE franchise_fee_id = NEW.franchise_fee_id AND investor_id = NEW.investor_id;
  IF v_amt IS NULL THEN RAISE EXCEPTION '此投資人不在該加盟金分攤名單'; END IF;
  v_t1 := round(v_amt * 0.45);
  v_t2 := round(v_amt * 0.45);
  v_target := CASE NEW.stage WHEN 1 THEN v_t1 WHEN 2 THEN v_t2 ELSE v_amt - v_t1 - v_t2 END;
  SELECT COALESCE(SUM(amount), 0) INTO v_paid
    FROM franchise_fee_payments
   WHERE franchise_fee_id = NEW.franchise_fee_id AND investor_id = NEW.investor_id
     AND stage = NEW.stage AND id <> NEW.id;
  IF v_paid + NEW.amount > v_target THEN
    RAISE EXCEPTION '第 % 期超收：本期目標 %，已收 %，本筆 % 超過（本期最多再收 %）',
      NEW.stage, v_target, v_paid, NEW.amount, GREATEST(v_target - v_paid, 0);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_ff_payment_cap ON public.franchise_fee_payments;
CREATE TRIGGER trg_ff_payment_cap BEFORE INSERT ON public.franchise_fee_payments
  FOR EACH ROW EXECUTE FUNCTION public.tg_ff_payment_cap();

-- 訂金：不得超過目標（固定 30 萬）
CREATE OR REPLACE FUNCTION public.tg_deposit_payment_cap()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_target NUMERIC; v_paid NUMERIC;
BEGIN
  SELECT target_amount INTO v_target FROM deposit_records WHERE id = NEW.deposit_id;
  SELECT COALESCE(SUM(amount), 0) INTO v_paid
    FROM deposit_payments WHERE deposit_id = NEW.deposit_id AND id <> NEW.id;
  IF v_paid + NEW.amount > v_target THEN
    RAISE EXCEPTION '訂金超收：目標 %，已收 %，本筆 % 超過（最多再收 %）',
      v_target, v_paid, NEW.amount, GREATEST(v_target - v_paid, 0);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_deposit_payment_cap ON public.deposit_payments;
CREATE TRIGGER trg_deposit_payment_cap BEFORE INSERT ON public.deposit_payments
  FOR EACH ROW EXECUTE FUNCTION public.tg_deposit_payment_cap();

COMMIT;

NOTIFY pgrst, 'reload schema';
