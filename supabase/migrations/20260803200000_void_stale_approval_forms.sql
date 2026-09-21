-- 清理舊「簽核管理(approval_forms)」殘留待簽單 — 2026-08-03
-- ════════════════════════════════════════════════════════════════════════════
-- 「簽核」選單已停用(業績總表/採購/稽核這類改走「非費用申請」自己的簽核鏈)。
-- 舊系統殘留 7 張待簽:#11 七月業績總表(唯一有關卡,但屬開錯地方的孤兒單,應改走
-- 非費用申請)+ #3~8 六張「0 關卡」壞單(永遠簽不完)。全部軟性標「已取消」(不硬刪,
-- 保留可查),讓 approval_forms 不再留待簽殘影。idempotent(只動仍為待簽的)。
-- ⚠️ #11 若真需要簽,請於「非費用申請」重新建立。
-- ════════════════════════════════════════════════════════════════════════════

UPDATE public.approval_forms
   SET status = '已取消', completed_at = now()
 WHERE id IN (3, 4, 5, 6, 7, 8, 11)
   AND status = '待簽';

UPDATE public.approval_form_steps
   SET status = '已取消',
       comment = COALESCE(NULLIF(comment, ''), '系統清理:簽核管理停用,改走非費用申請')
 WHERE form_id IN (3, 4, 5, 6, 7, 8, 11)
   AND status IN ('待簽', '等待中');

NOTIFY pgrst, 'reload schema';
