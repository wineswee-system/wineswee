# 資料存取框架 (RLS Access Framework)

> 目的:用「角色/職責 × 資料類別」的框架決定誰看得到什麼,**每張表歸一個類別、套該類別的固定規則**,
> 不再逐表客製。新增表或新增人時,照框架歸類即可,避免越來越亂。
> 最後更新 2026-07-02。

---

## 維度一:看的人的「職責範圍」

職責**從組織結構算出來,不靠職稱文字**(職稱不可靠,例:督導的 role 是 manager)。

| 身份 | 判定來源(可靠) | 看得到的「人」 |
|------|----------------|----------------|
| super_admin / admin | `roles.name` | 全部 |
| HR 人員 | `departments.name = '人力資源部'`(`is_hr_staff()`) | 全公司所有人的 HR 資料 |
| 課督導 / 課長 | `department_sections.supervisor_id` | 該課**所有門市**的人 |
| 店長 | `stores.manager_id` | 該店的人 |
| 直屬主管 | `employees.supervisor_id` 鏈(遞迴) | 直屬下屬(含多層) |
| 本人 | `current_employee_id()` | 自己 |

## 維度二:資料類別(每張表歸一類)

| 類別 | 可見規則 | 對應 helper |
|------|----------|-------------|
| ① 個人 / HR | 本人 + 垂直主管(店長→課督導→supervisor 鏈)+ HR + admin | `can_see_request(emp)` |
| ② 工作項目 | **只有參與者**(指派/建立/擁有/成員/發起/目標)+ admin。**主管不自動看下屬的** | 直接比對參與者欄 + `is_project_member()` |
| ③ 門市營運 | 該店/課的**管理者**(店長/課督導)+ admin(編輯類);本人(查詢類) | `can_manage_store()` / `can_see_store()` |
| ④ 公司營運 | 同公司(org)皆可,跨租戶擋 | `org_visible(organization_id)` |
| ⑤ 高敏 | 本人讀;HR / admin 寫 | `can_see_own(emp)` 讀 / `is_admin() OR is_hr_staff()` 寫 |
| ⑥ 設定 / 參考 / 系統 | 參考表同 org 可讀;設定/log 限 admin | `org_visible` 讀 / `is_admin()` |

## 維度三:能力 (role)

「能不能**做**」(編輯/核准/刪除)由 role + 細項權限(`liff_employee_has_permission`)決定,
**跟「看得到誰的」分開**。寫入一律至少 `is_staff()`(擋 anon),敏感寫入再加 role/權限/職責條件。

---

## helper 速查

| helper | 意義 |
|--------|------|
| `is_admin()` | admin / super_admin |
| `is_hr_staff()` | admin / service / 人力資源部成員 |
| `current_employee_id()` / `current_user_org()` | 目前登入者的 emp id / org |
| `can_see_request(emp)` | ① 本人/垂直主管/課督導/HR/admin |
| `can_see_own(emp)` | ⑤ 本人/HR/admin |
| `can_see_store(store)` | 該店成員/店長/課督導/user_stores/admin(查詢級) |
| `can_manage_store(store)` / `can_manage_emp_store(id,name)` | 店長/課督導/admin(管理級,如排班) |
| `org_visible(org)` | ④ 同 org / admin / service |
| `is_project_member(project)` | ② 是該專案成員 |
| `is_staff()` | authenticated / service(擋 anon 寫入用) |

---

## 每張表歸類

### ① 個人 / HR — `can_see_request`
off_requests, leave_requests, expense_requests, expenses, overtime_requests,
clock_corrections, resignation_requests, leave_of_absence_requests,
leave_cancellation_requests, personnel_transfer_requests, headcount_requests,
form_submissions, business_trips, certifications, education_records, employee_contracts,
family_members, foreign_worker_docs, foreign_worker_profiles, nhi_supplementary_records,
position_history, store_audit_on_duty, store_bonus_employee, work_experiences,
employee_assignments, accommodation_assignments, annual_bonus_tracker,
**attendance_records**, **salary_records**, **leave_balances**,
schedules(**讀**;寫見③)

> ⚠️ `attendance_records` / `salary_records` / `leave_balances` 原有 `auth_<table>` USING(true)
> catch-all policy，已於 `20260702100000` 清除並改套 `can_see_request(employee_id)`。

### ② 工作項目 — 純參與者 + admin
tasks(指派/建立/同專案成員), projects(owner/成員), project_members(本人/同專案), workflow_instances(發起/目標/申請人)

### ③ 門市營運 — `can_manage_store` / `can_see_store`
schedules(**寫** = `can_manage_emp_store`), schedule_month_locks, shift_swaps,
store_audits, store_bonus_monthly

### ④ 公司營運 — `org_visible`(讀同 org;寫 `is_staff` 或 org_visible)
**employees**(SELECT 同 org 全員可見，排班/審核需要互查;INSERT/DELETE 限 admin;UPDATE 本人或 manager+),
customers, skus, accounts, accounts_payable, accounts_receivable, suppliers, warehouses,
bins, stock_levels, invoices, inbound_orders, inbound_items, outbound_orders, outbound_items,
goods_receipts, journal_entries, journal_lines, sales_orders, sales_returns, quotations,
inventory_adjustments, notifications, recruitment_jobs, task_attachments, form_chain_configs,
form_templates, project_sections, project_templates, project_comments, project_custom_field_*,
store_bonus_role_config, department_sections, accommodations, broker_agencies, kpi_data,
locations, checklist_items, store_audit_items, marketing_campaigns, opportunities, returns,
service_tickets, shipments, promotions, quality_inspections, mrp_results, ecommerce_*,
on/offboarding_plans, tax_filings, schedule_data, line_*_summaries, department_line_groups,
workflow_instance_line_group_assignments, sop_template_versions, referral_*, point_transactions,
inquiries, customer_contacts, bom, workflows, employee_schedule_patterns

### ⑤ 高敏 — `can_see_own` 讀 / admin·HR 寫
salary_adjustments, severance_records, line_users, employee_line_accounts

### ⑥ 設定 / 參考 / 系統
- 參考(同 org 可讀):roles, permissions, organizations, members, holidays,
  health_ins_brackets, labor_ins_brackets, shift_code_times, module_access, role_permissions
- 設定(org 讀 + admin 寫):approval_rules, approval_extra_steps
- 系統/log(限 admin/service):audit_logs, deletion_drain, message_logs, event_outbox,
  triggers, attrition_risk_snapshots, line_channels
- 物化檢視(RLS 另案):mv_customer_revenue, mv_daily_sales
- 採購(營運共享,採購部需看全部):purchase_requests, purchase_orders

---

## 新增表/新增人時怎麼做

1. **新表** → 判斷屬於 ①~⑥ 哪類 → 掛該類別的 helper policy(別自己另寫一套)。
2. **新角色職責**(例:新課督導)→ 設好結構指派(`department_sections.supervisor_id` /
   `stores.manager_id` / `employees.supervisor_id`)即可,RLS 自動生效,不用改碼。
3. **新功能需跨範圍存取**(例:財務專員看全公司財務)→ 比照 `is_hr_staff()` 加一個職責 helper
   (`is_finance_staff()` 等),折進對應類別,**不要逐表客製 admin 判斷**。

## 安全鐵則

- 寫(INSERT/UPDATE/DELETE)policy **絕不可用 `true`**(anon 有 grant 會變公網寫入洞);
  最低 `is_staff()`,能 scope 就 scope。
- anon 一律走 SECURITY DEFINER RPC,不給直接寫表 grant。
- 改 RLS 後必跑 `security_health_check()` 看 🔴(anon公網)有沒有新增。
- policy 全走 helper → 出事可把 helper 暫時 `RETURN true` 秒退。
