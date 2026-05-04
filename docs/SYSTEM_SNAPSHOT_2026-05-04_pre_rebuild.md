# 系統重建前快照 — 2026-05-04

> 此檔案記錄組織重建前所有「**人 ↔ 系統**」的連接點。
> 重建完員工資料後，照本檔案重新接回 LINE 綁定 / Auth 帳號 / 簽核鏈步驟 / 權限。

---

## 📊 1. 數量總覽（重建前）

| 項目 | 數量 |
|---|---|
| Organization | 1 |
| Departments | 19 |
| Stores | 16 |
| 在職員工 | 104 |
| LINE 綁定 | 10 筆（8 人，Snow 跟洪伯嘉各兩 channel）|
| Auth 帳號（已連 employees）| 9 |
| Active approval chains | 11 |
| Active workflow_instances | 10 |
| Pending tasks | 80 |
| Pending task_confirmations | 24 |
| 申請中 expense_requests | 8 |
| 待審 leave_requests | 1 |
| 待審 overtime_requests | 2 |
| 待審 expenses | 1 |

---

## 📲 2. LINE 綁定（10 筆 ⇒ 8 人）

每個員工的 `line_user_id` **不會變**（屬於 LINE 平台），重建後要重新插回 `employee_line_accounts`：

| emp_id | 員工 | dept | role | channel | line_user_id |
|---|---|---|---|---|---|
| 152 | Danny | 人力資源部 | admin | workflow | `U74898dbf233f49d44990bc3757464224` |
| 48 | Dave | 營運部 | admin | workflow | `Ua9eabab39ba6daec5f0228fa8ba2c23d` |
| 148 | Molly | 營運部 | admin | workflow | `U951e75c74af725a46ddccca15d5f10d2` |
| 44 | Snow | 營運部 | super_admin | workflow + default | `Ub261da23e4c20b180f1d283c71d4f1e2` |
| 52 | Zoey | 品牌行銷部 | admin | workflow | `U420564e6a7cae7ceb6fe377585e5f781` |
| 58 | 尤致皓 | 人力資源部 | admin | workflow | `U6a8a5c5a7011ce5d5cd1d03c668d26fb` |
| 62 | 張庭瑋 | 營運部 | admin | workflow | `U17ad006a80fba75564d029b54f998518` |
| 10 | 洪伯嘉 | 營運部 | super_admin | workflow + default | `U5075609bee562b1ab92f41e746b98fcc` |

**重建後重接 SQL 模板**：
```sql
INSERT INTO employee_line_accounts (employee_id, channel_id, line_user_id, is_primary)
VALUES (
  (SELECT id FROM employees WHERE name = '<新員工 name>'),
  (SELECT id FROM line_channels WHERE code = 'workflow'),
  '<line_user_id>',
  true
);
```

---

## 🔐 3. Supabase Auth 綁定（9 筆）

`auth.users` 表本身不會被重建影響，**只要把新 employees 的 `auth_user_id` 對回去**即可：

| emp_id | name | name_en | role | auth_user_id (UUID) | auth_email |
|---|---|---|---|---|---|
| 152 | Danny | – | admin | `789944c2-0705-4842-8404-3b5def684339` | `line_xxx@sme-ops.local` |
| 48 | Dave | Dave | admin | `316ddeb1-f0b2-4736-b0cd-da6433e6bd26` | `line_xxx@sme-ops.local` |
| 148 | Molly | – | admin | `650cc9d8-c78f-48bc-b3a4-9b777b9d718b` | `line_xxx@sme-ops.local` |
| 44 | Snow | Snow | super_admin | `0a03ff03-13ac-4e42-b389-f03132a03874` | `astrops.psych@gmail.com` |
| 52 | Zoey | Zoey | admin | `b8599fc8-b444-4004-8344-148cb432b4c2` | `line_xxx@sme-ops.local` |
| 58 | 尤致皓 | – | admin | `1d064c8c-4d6b-4463-895b-82cba9886f9f` | `line_xxx@sme-ops.local` |
| 62 | 張庭瑋 | – | admin | `0ac8192e-64af-4c2a-aab0-8fb43d4a1528` | `line_xxx@sme-ops.local` |
| 10 | 洪伯嘉 | Aska Hung | super_admin | `1cc68c2e-9612-4b5a-b089-b79d12b3bc77` | `aska20021023@gmail.com` |
| 205 | 測試員工 | – | store_staff | `bcccadb2-2b61-4c4c-962f-33b554e52b62` | `staff@demo.sme` |
| 204 | 測試管理員 | – | admin | `b0e9fec7-92a8-4b63-bbac-e04bec896b98` | `admin@demo.sme` |

**重建後重接 SQL 模板**：
```sql
UPDATE employees
SET auth_user_id = '<UUID>'
WHERE name = '<新員工 name>';
```

---

## 📋 4. Active Approval Chains（11 條）

### Chain 1: 員工請假簽核 (HR, 0~∞)
- step 0: 直屬主管審核 — **label only ⚠️ 沒指定人**
- step 1: 督導確認 — label only
- step 2: HR確認 — label only

### Chain 2: 執行長簽核 (管理, 0~∞) ✅
- step 0: 部門經理審核 → 尤致皓
- step 1: 執行長核准 → Snow

### Chain 3: 營運主管簽核 (營運, 0~∞)
- step 0: 店長審核 — label only ⚠️
- step 1: 督導確認 — label only ⚠️
- step 2: 營運主管核准 — target_type=department，沒指定 dept_id ⚠️

### Chain 4: 人資及執行長簽核 (HR, 0~∞)
- step 0: HR審核 — label only ⚠️
- step 1: 執行長核准 — label only ⚠️

### Chain 5: 採購簽核 (採購, 0~∞)
- step 0: 需求確認 — label only ⚠️
- step 1: 採購審核 — target_type=department, 沒指定 dept ⚠️
- step 2: 主管核准 — label only ⚠️

### Chain 6: 門市簽核 (營運, 0~∞)
- step 0: 店長核准 — label only ⚠️

### Chain 7: 外出申請免簽核 (營運, 0~∞)
- 沒任何步驟 — 等於免簽

### Chain 8: 小額費用申請 (費用申請, 0~3000) ✅
- step 0: 主管審核 → Dave (id 48)

### Chain 9: 中額費用申請 (費用申請, 3001~10000) ✅
- step 0: 主管審核 → Snow (id 44)
- step 1: 部門主管審核 → Danny (id 152)

### Chain 10: 大額費用申請 (費用申請, 10001+) ✅
- step 0: 主管審核 → Zoey (id 52)
- step 1: 部門主管審核 → 尤致皓 (id 58)
- step 2: 財務確認 → Dave (id 48)

### Chain 11: 請假 (HR, 0~∞) ✅
- step 0: → Dave (id 48)

**重建後重接 SQL 模板**：
```sql
UPDATE approval_chain_steps
SET target_emp_id = (SELECT id FROM employees WHERE name = '<新員工 name>'),
    target_type = 'employee'
WHERE chain_id = <chain_id> AND step_order = <step_order>;
```

---

## 🛡 5. Role-Permission Matrix（5 角色 × 15 權限）

| Permission | Module | super_admin | admin | manager | office_staff | store_staff |
|---|---|:---:|:---:|:---:|:---:|:---:|
| customer.edit | CRM | ✅ | ✅ | ❌ | ❌ | ❌ |
| customer.view_full | CRM | ✅ | ✅ | ❌ | ❌ | ❌ |
| employee.edit | 人資 | ✅ | ✅ | ✅ | ❌ | ❌ |
| employee.view | 人資 | ✅ | ✅ | ✅ | ✅ | ✅ |
| employee.view_full | 人資 | ✅ | ✅ | ✅ | ❌ | ❌ |
| leave.approve | 人資 | ✅ | ✅ | ✅ | ✅ | ❌ |
| salary.view | 人資 | ✅ | ✅ | ✅ | ✅ | ✅ |
| salary.view_all | 人資 | ✅ | ✅ | ❌ | ❌ | ❌ |
| inventory.edit | 倉儲 | ✅ | ✅ | ❌ | ❌ | ❌ |
| po.create | 採購 | ✅ | ✅ | ❌ | ❌ | ❌ |
| pr.approve | 採購 | ✅ | ✅ | ✅ | ❌ | ❌ |
| audit.view | 系統 | ✅ | ✅ | ❌ | ❌ | ❌ |
| system.admin | 系統 | ✅ | ✅ | ❌ | ❌ | ❌ |
| finance.edit | 財務 | ✅ | ✅ | ✅ | ❌ | ❌ |
| finance.view | 財務 | ✅ | ✅ | ✅ | ❌ | ❌ |

→ **角色與權限關聯不會被重建影響**（roles + role_permissions + permissions 三張表跟員工無關）。重建只動 employees。

---

## 🚧 6. In-flight 單據 (重建前要先處理)

| 類型 | 待審筆數 | 處理建議 |
|---|---|---|
| expense_request | 8 | 全部結案（核准或駁回）後再重建 |
| leave_request | 1 | 同上 |
| overtime_request | 2 | 同上 |
| expense | 1 | 同上 |
| business_trip | 0 | – |
| task_pending | 80 | 看哪些是真的還在跑、哪些可以清除 |
| workflow_active | 10 | 同上 |
| task_confirmation_pending | 24 | 跟著 task 一起處理 |

**注意**：task / workflow 用了 employee_id 當 FK，員工重建後會斷。如果不結案就重建：
- 舊 task.assignee_id 指向不存在的員工 → 顯示異常但不會炸
- 簽核流程如果跑到一半，重建後可能找不到對應的 chain 步驟

---

## 🔧 7. 系統設定（不會被重建影響）

- **LINE channel**：Wineswe 員工機器人 (channel_id 2009191289)
- **LIFF channel id**：`2009642363-lqpzLwFk`
- **Supabase project**：`mvkvnuxeamahhfahclmi`
- **Edge Functions**：line-push, line-webhook, line-login, hr-notify, send-payslips, task-reminder, check-missed-clockout, invite-employee, gemini-proxy, clock-in
- **Edge Function secrets** 不會掉
- **RLS policies** 不會掉（除非手動 DROP）

---

## 🛠 8. 重建後的重接 SOP（建議順序）

1. **新員工資料 INSERT** 完成
2. 把 8 個有 LINE 綁定的人**先補 `auth_user_id`**（從第 3 節表）
3. 把那 8 個人**重新插 `employee_line_accounts`**（從第 2 節表）
4. **更新 5 條好的 chain（2/8/9/10/11）的 `target_emp_id`**（從第 4 節）
5. label-only 的 chain（1/3/4/5/6）依新組織圖**逐步補 target_emp_id**
6. 跑 `npx supabase db query` 驗證 8 人都連得到
7. 找 8 人**重 LINE 登入測試**

---

## 📌 重建前 Checklist

- [ ] In-flight 單據都結案 / 清除
- [ ] 備份當前 employees 表
- [ ] 備份當前 employee_line_accounts 表
- [ ] 備份當前 approval_chain_steps 表
- [ ] 確認新組織圖完整（含 LINE 沒綁的 96 個店員）
- [ ] 確認新員工資料的 organization_id 都是 1
- [ ] 確認跟老闆談完誰用什麼 role

---

**生成時間**: 2026-05-04  
**目的**: 系統 employees 重建前快照  
**重接負責人**: 你 + Claude
