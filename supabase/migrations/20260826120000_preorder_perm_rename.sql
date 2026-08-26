-- 線上預購改走「業務申請中心」卡片(對齊 收款/裝潢/維修),權限碼 nav.entry.process.preorders → preorder.manage
UPDATE public.permissions
   SET code = 'preorder.manage', name = '線上預購（業務申請）', module = '專案流程'
 WHERE code = 'nav.entry.process.preorders';
