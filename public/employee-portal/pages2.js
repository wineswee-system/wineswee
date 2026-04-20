// ========== pages2.js — Expense, Contacts, Profile, Announcement Detail ==========

// ========== EXPENSE PAGE ==========
function renderExpense() {
  return `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
      <div class="page-title" style="margin-bottom:0"><i data-lucide="receipt"></i> 費用申請</div>
      <button class="btn btn-primary" onclick="openExpenseModal()"><i data-lucide="plus" style="width:16px;height:16px"></i> 新增費用</button>
    </div>
    <div class="card">
      <div class="card-hd">申請紀錄</div>
      <table>
        <thead><tr><th>單號</th><th>類別</th><th>金額</th><th>日期</th><th>說明</th><th>狀態</th></tr></thead>
        <tbody>
          ${EXPENSE_HISTORY.map(e => `
            <tr><td>${e.id}</td><td>${e.category}</td><td>$${formatMoney(e.amount)}</td><td>${e.date}</td><td>${e.desc}</td><td>${statusBadge(e.status)}</td></tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function openExpenseModal() {
  openModal(`
    <div class="modal-title">新增費用申請<span class="modal-close" onclick="closeModal()">&times;</span></div>
    <div class="form-group"><label>費用類別</label><select id="expCategory"><option>交通</option><option>住宿</option><option>餐飲</option><option>設備</option><option>其他</option></select></div>
    <div class="form-group"><label>金額</label><input id="expAmount" type="number" placeholder="請輸入金額"></div>
    <div class="form-group"><label>日期</label><input id="expDate" type="date" value="2026-04-17"></div>
    <div class="form-group"><label>說明</label><textarea id="expDesc" rows="3" placeholder="請輸入費用說明..."></textarea></div>
    <div class="form-group"><label>收據附件</label><input type="file" accept=".pdf,.jpg,.jpeg,.png" style="padding:6px"><div style="font-size:.75rem;color:var(--fg-4);margin-top:4px">上傳收據照片或 PDF</div></div>
    <div class="form-actions">
      <button class="btn btn-ghost" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" onclick="submitExpense()">送出申請</button>
    </div>
  `);
}

async function submitExpense() {
  const category = document.querySelector('#expCategory').value;
  const amount = parseInt(document.querySelector('#expAmount').value);
  const date = document.querySelector('#expDate').value;
  const desc = document.querySelector('#expDesc').value;
  if (!amount || amount <= 0) { showToast('請輸入有效金額', 'alert-circle'); return; }
  const { error } = await sb.from('expenses').insert({
    employee: EMPLOYEE.name,
    category: category,
    amount: amount,
    date: date,
    description: desc,
    status: '待審核'
  });
  if (error) { showToast('送出失敗：' + error.message, 'alert-circle'); return; }
  closeModal();
  showToast('費用申請已送出！', 'check-circle-2');
  await loadAllData();
  render();
}

function openBizTripModal() {
  openModal(`
    <div class="modal-title">新增出差申請<span class="modal-close" onclick="closeModal()">&times;</span></div>
    <div class="form-group"><label>出差地點</label><input type="text" placeholder="請輸入出差目的地"></div>
    <div class="form-group"><label>開始日期</label><input type="date" value="2026-04-21"></div>
    <div class="form-group"><label>結束日期</label><input type="date" value="2026-04-22"></div>
    <div class="form-group"><label>出差目的</label><textarea rows="3" placeholder="請輸入出差目的..."></textarea></div>
    <div class="form-group"><label>預估費用</label><input type="number" placeholder="請輸入預估費用"></div>
    <div class="form-actions">
      <button class="btn btn-ghost" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" onclick="closeModal();showToast('出差申請已送出！','check-circle-2')">送出申請</button>
    </div>
  `);
}

function openSwapShiftModal() {
  openModal(`
    <div class="modal-title">換班申請<span class="modal-close" onclick="closeModal()">&times;</span></div>
    <div class="form-group"><label>換班同事</label><select><option value="">請選擇同事</option><option>Vicky</option><option>SNOW</option><option>Ken</option><option>Dave</option><option>Alicia</option><option>Zoey</option><option>學文</option></select></div>
    <div class="form-group"><label>我的班次日期</label><input type="date" value="2026-04-21"></div>
    <div class="form-group"><label>對方班次日期</label><input type="date" value="2026-04-22"></div>
    <div class="form-group"><label>換班原因</label><textarea rows="3" placeholder="請輸入換班原因..."></textarea></div>
    <div class="form-actions">
      <button class="btn btn-ghost" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" onclick="closeModal();showToast('換班申請已送出！','check-circle-2')">送出申請</button>
    </div>
  `);
}

// ========== CONTACTS PAGE ==========
function renderContacts() {
  const depts = [...new Set(CONTACTS_FULL.map(c => c.dept))];
  let filtered = CONTACTS_FULL;
  if (contactSearch) {
    const q = contactSearch.toLowerCase();
    filtered = filtered.filter(c => c.name.toLowerCase().includes(q) || c.position.toLowerCase().includes(q) || c.dept.toLowerCase().includes(q));
  }
  if (contactDeptFilter) {
    filtered = filtered.filter(c => c.dept === contactDeptFilter);
  }

  return `
    <div class="page-title"><i data-lucide="users"></i> 通訊錄</div>
    <div class="card" style="margin-bottom:16px">
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        <div style="flex:1;min-width:200px"><input type="text" placeholder="搜尋姓名、職位、部門..." value="${contactSearch}" oninput="contactSearch=this.value;document.getElementById('app').innerHTML=renderContacts();if(window.lucide)lucide.createIcons()"></div>
        <div style="min-width:150px"><select onchange="contactDeptFilter=this.value;document.getElementById('app').innerHTML=renderContacts();if(window.lucide)lucide.createIcons()"><option value="">全部部門</option>${depts.map(d => `<option ${contactDeptFilter===d?'selected':''}>${d}</option>`).join('')}</select></div>
      </div>
    </div>
    <div class="card">
      <div style="font-size:.82rem;color:var(--fg-3);margin-bottom:12px">共 ${filtered.length} 位聯絡人</div>
      ${filtered.length === 0 ? '<div style="padding:20px;text-align:center;color:var(--fg-4);font-size:.85rem">找不到符合的聯絡人</div>' :
        filtered.map(c => `
          <div class="contact-full-item" onclick="openContactDetail('${c.name}')">
            <div class="contact-full-avatar" style="background:${c.bg};color:${c.fg}">${c.initials}</div>
            <div class="contact-full-info">
              <div class="contact-full-name">${c.name}</div>
              <div class="contact-full-meta">${c.position} &middot; ${c.dept} &middot; ${c.store}</div>
            </div>
            <div class="contact-full-phone"><i data-lucide="phone" style="width:14px;height:14px;vertical-align:-2px"></i> ${c.phone}</div>
          </div>
        `).join('')}
    </div>
  `;
}

function openContactDetail(name) {
  const c = CONTACTS_FULL.find(x => x.name === name);
  if (!c) return;
  openModal(`
    <div class="modal-title">
      <span>聯絡人資訊</span>
      <span class="modal-close" onclick="closeModal()">&times;</span>
    </div>
    <div style="text-align:center;margin-bottom:18px">
      <div style="width:64px;height:64px;border-radius:50%;background:${c.bg};color:${c.fg};display:inline-flex;align-items:center;justify-content:center;font-size:1.5rem;font-weight:700;margin-bottom:8px">${c.initials}</div>
      <div style="font-size:1.1rem;font-weight:700">${c.name}</div>
      <div style="font-size:.85rem;color:var(--fg-3)">${c.position}</div>
    </div>
    <div class="profile-field"><div class="profile-label">部門</div><div class="profile-value">${c.dept}</div></div>
    <div class="profile-field"><div class="profile-label">門市/據點</div><div class="profile-value">${c.store}</div></div>
    <div class="profile-field"><div class="profile-label">電話</div><div class="profile-value">${c.phone}</div></div>
    <div class="form-actions"><button class="btn btn-ghost" onclick="closeModal()">關閉</button></div>
  `);
}

// ========== PROFILE PAGE ==========
function renderProfile() {
  return `
    <div class="page-title"><i data-lucide="user-circle"></i> 個人資料</div>

    <!-- Profile hero -->
    <div class="card" style="text-align:center;padding:28px;margin-bottom:20px">
      <div style="width:72px;height:72px;border-radius:50%;background:var(--accent-soft);color:var(--accent);display:inline-flex;align-items:center;justify-content:center;font-size:1.8rem;font-weight:700;margin-bottom:8px">${EMPLOYEE.name.charAt(0)}</div>
      <div style="font-size:1.2rem;font-weight:700">${EMPLOYEE.name}</div>
      <div style="font-size:.85rem;color:var(--fg-3)">${EMPLOYEE.dept} · ${EMPLOYEE.position}</div>
      <div style="font-size:.8rem;color:var(--fg-4);margin-top:4px">${EMPLOYEE.empId} · ${EMPLOYEE.store}</div>
    </div>

    <div class="profile-grid">
      <div class="card">
        <div class="card-hd"><i data-lucide="user"></i> 基本資料</div>
        <div class="profile-field"><div class="profile-label">姓名</div><div class="profile-value">${EMPLOYEE.name}</div></div>
        <div class="profile-field"><div class="profile-label">員工編號</div><div class="profile-value">${EMPLOYEE.empId}</div></div>
        <div class="profile-field"><div class="profile-label">部門</div><div class="profile-value">${EMPLOYEE.dept}</div></div>
        <div class="profile-field"><div class="profile-label">職位</div><div class="profile-value">${EMPLOYEE.position}</div></div>
        <div class="profile-field"><div class="profile-label">到職日</div><div class="profile-value">${EMPLOYEE.joinDate}</div></div>
        <div class="profile-field"><div class="profile-label">生日</div><div class="profile-value">${EMPLOYEE.birthday}</div></div>
        <div class="profile-field"><div class="profile-label">性別</div><div class="profile-value">${EMPLOYEE.gender}</div></div>
      </div>
      <div class="card">
        <div class="card-hd"><i data-lucide="phone"></i> 聯絡資訊</div>
        <div class="profile-field"><div class="profile-label">Email</div><div class="profile-value">${EMPLOYEE.email}</div></div>
        <div class="profile-field"><div class="profile-label">手機</div><div class="profile-value">${EMPLOYEE.phone}</div></div>
        <div class="profile-field"><div class="profile-label">地址</div><div class="profile-value">${EMPLOYEE.address}</div></div>
      </div>
      <div class="card">
        <div class="card-hd"><i data-lucide="heart-pulse"></i> 緊急聯絡人</div>
        <div class="profile-field"><div class="profile-label">姓名</div><div class="profile-value">${EMPLOYEE.emergencyName}</div></div>
        <div class="profile-field"><div class="profile-label">關係</div><div class="profile-value">${EMPLOYEE.emergencyRel}</div></div>
        <div class="profile-field"><div class="profile-label">電話</div><div class="profile-value">${EMPLOYEE.emergencyPhone}</div></div>
      </div>
      <div class="card">
        <div class="card-hd"><i data-lucide="landmark"></i> 銀行帳戶</div>
        <div class="profile-field"><div class="profile-label">銀行</div><div class="profile-value">${EMPLOYEE.bankName}</div></div>
        <div class="profile-field"><div class="profile-label">帳號</div><div class="profile-value">${EMPLOYEE.bankAccount}</div></div>
      </div>
    </div>

    <div class="card" style="margin-top:20px">
      <div class="card-hd"><i data-lucide="lock"></i> 修改密碼</div>
      <div style="max-width:400px">
        <div class="form-group"><label>目前密碼</label><input type="password" placeholder="請輸入目前密碼"></div>
        <div class="form-group"><label>新密碼</label><input type="password" placeholder="請輸入新密碼"></div>
        <div class="form-group"><label>確認新密碼</label><input type="password" placeholder="請再次輸入新密碼"></div>
        <div class="form-actions" style="justify-content:flex-start"><button class="btn btn-primary" onclick="showToast('密碼修改成功！','check-circle-2')">更新密碼</button></div>
      </div>
    </div>
  `;
}

// ========== ANNOUNCEMENT DETAIL ==========
function openAnnouncementDetail(index) {
  const a = ANNOUNCEMENTS[index];
  openModal(`
    <div class="modal-title">
      <span>
        ${a.pinned ? '<span class="announce-tag" style="background:oklch(0.93 0.05 25);color:oklch(0.50 0.18 25)">置頂</span> ' : ''}
        <span class="announce-tag" style="background:${a.tagBg};color:${a.tagColor}">${a.tag}</span>
        ${a.title}
      </span>
      <span class="modal-close" onclick="closeModal()">&times;</span>
    </div>
    <div style="font-size:.8rem;color:var(--fg-4);margin-bottom:14px">發佈日期：${a.date}</div>
    <div style="font-size:.88rem;line-height:1.7;white-space:pre-line;color:var(--fg-2)">${a.detail}</div>
    <div class="form-actions"><button class="btn btn-ghost" onclick="closeModal()">關閉</button></div>
  `);
}
