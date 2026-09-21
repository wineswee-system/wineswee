-- Snow（工程師）被誤標 is_manager = true，改回 false 讓他顯示在部門下方。
UPDATE public.employees
   SET is_manager = false
 WHERE name = 'Snow'
   AND is_manager = true;
