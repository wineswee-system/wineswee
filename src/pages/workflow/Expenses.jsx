import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useReturnNav } from '../../lib/useReturnNav'
import { Plus, Printer, Settings, Paperclip, Search, X, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import { getExpenses, createExpense, updateExpenseStatus, getAccounts } from '../../lib/db'
import { createApprovalWorkflow } from '../../lib/workflowIntegration'
import { supabase } from '../../lib/supabase'
import { getEventBus } from '../../lib/events/index.js'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import SearchableSelect, { empOptions } from '../../components/SearchableSelect'
import { empLabel } from '../../lib/empLabel'
import CarriedAttachments from '../../components/CarriedAttachments'
import { printExpenseSimpleSignOff } from '../../lib/signOffAdapters'
import ApprovalDetailModal from '../../components/ApprovalDetailModal'
import { buildFormChainSteps } from '../../lib/buildChainSteps'
import { validateRequired, clearError } from '../../lib/formValidation'
import { usePendingApprovals } from '../../lib/usePendingApprovals'
import { postBindingFillDone } from '../../lib/embeddedBinding'

import { toast } from '../../lib/toast'
const CATEGORIES = ['交通', '住宿', '餐飲', '設備', '其他']
const emptyItem = () => ({ name: '', qty: 1, unit_price: '', subtotal: 0 })

export default function Expenses() {
  const { profile, hasPermission } = useAuth()
  const canDeleteAll = hasPermission('hr_form.delete_all')
  const { canApprove } = usePendingApprovals()
  const navigate = useNavigate()
  const returnNav = useReturnNav()
  const [expenses, setExpenses] = useState([])
  const [accounts, setAccounts] = useState([])   // 會計科目（跟費用申請同源 accounts 表）
  const [employees, setEmployees] = useState([])
  const [departments, setDepartments] = useState([])
  const [deptFilter, setDeptFilter] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [dateSort, setDateSort] = useState('desc') // 'asc' | 'desc'
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [cloneSourceAtts, setCloneSourceAtts] = useState([])  // 複製重送：來源單的附件 URL（送出後複製 storage 檔）
  const [form, setForm] = useState({ employee: '', category: CATEGORIES[0], date: '', description: '', receipt: true })
  const [lineItems, setLineItems] = useState([emptyItem()])
  const [errors, setErrors] = useState({})
  const [organization, setOrganization] = useState(null)  // 印簽呈用
  const [detailRow, setDetailRow] = useState(null)
  const [detailChainSteps, setDetailChainSteps] = useState([])
  const [loadingChain, setLoadingChain] = useState(false)
  const detailRowIdRef = useRef(null)
  // 附件（對齊 LIFF）：bucket 'expense-receipts'
  const [attachFiles, setAttachFiles] = useState([])
  const [uploading, setUploading] = useState(false)

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files || [])
    const newFiles = files.map(f => ({ file: f, preview: URL.createObjectURL(f) }))
    setAttachFiles(prev => [...prev, ...newFiles].slice(0, 5))
    e.target.value = ''
  }
  const removeAttach = (idx) => {
    setAttachFiles(prev => {
      try { URL.revokeObjectURL(prev[idx].preview) } catch {}
      return prev.filter((_, i) => i !== idx)
    })
  }
  const uploadAttachments = async (expenseId, empId) => {
    if (attachFiles.length === 0) return []
    setUploading(true)
    const urls = []
    try {
      for (const { file } of attachFiles) {
        const ext = (file.name.split('.').pop() || 'bin').toLowerCase()
        const path = `emp-${empId || 'unknown'}/${expenseId}-${Date.now()}.${ext}`
        const { error } = await supabase.storage.from('expense-receipts').upload(path, file, {
          cacheControl: '3600', upsert: true,
        })
        if (error) {
          console.warn('upload fail:', error)
          continue
        }
        const { data } = supabase.storage.from('expense-receipts').getPublicUrl(path)
        if (data?.publicUrl) urls.push(data.publicUrl)
      }
      // ★ 修補：URL 寫回 expenses.attachments，不然審核人看不到
      if (urls.length > 0) {
        const { error: updErr } = await supabase.from('expenses')
          .update({ attachments: urls })
          .eq('id', expenseId)
        if (updErr) console.warn('attach urls update fail:', updErr)
      }
    } finally {
      setUploading(false)
    }
    return urls
  }

  // 核准/駁回後重抓清單（明細 modal onChanged 用）。只刷 expenses，不重置表單。
  const load = async () => {
    const { data } = await getExpenses()
    setExpenses(data || [])
  }

  useEffect(() => {
    const orgId = profile?.organization_id
    Promise.all([
      getExpenses(),
      supabase.from('employees').select('id, name, name_en, dept, department_id, store, store_id, position, signature_url, departments!department_id(name), stores!store_id(name)').eq('status', '在職').order('name'),
      supabase.from('departments').select('*').order('name'),
      orgId ? supabase.from('organizations').select('name, logo_url').eq('id', orgId).maybeSingle() : Promise.resolve({ data: null }),
      getAccounts(orgId),
    ]).then(([ex, e, d, orgRes, accRes]) => {
      const emps = e.data || []
      const accs = accRes?.data || []
      setExpenses(ex.data || [])
      setEmployees(emps)
      setDepartments(d.data || [])
      setOrganization(orgRes?.data || null)
      setAccounts(accs)
      setForm(f => ({ ...f, employee: f.employee || profile?.name || emps[0]?.name || '', category: f.category || accs[0]?.name || '' }))
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => {
      setLoading(false)
    })
  }, [])

  // Dashboard ApprovalCenter 跳過來時 ?focus=ID 自動開明細
  const [searchParams, setSearchParams] = useSearchParams()
  useEffect(() => {
    const focus = searchParams.get('focus')
    if (!focus || !expenses.length) return
    const row = expenses.find(e => e.id === Number(focus))
    if (row) {
      openDetail(row)
      setSearchParams(sp => { const x = new URLSearchParams(sp); x.delete('focus'); return x }, { replace: true })
    }
  }, [expenses, searchParams]) // eslint-disable-line react-hooks/exhaustive-deps

  // 從任務填寫狀態跳過來 ?new=1&binding_id=N → 自動開新增費用 modal
  // 開完就把 new=1 拿掉，避免關 modal 後重彈；binding_id 留著給 submit 使用
  useEffect(() => {
    if (searchParams.get('new') === '1' && !showModal) {
      setEditingId(null)
      setForm({ employee: '', category: CATEGORIES[0], date: '', description: '', receipt: true })
      setLineItems([emptyItem()])
      setShowModal(true)
      const next = new URLSearchParams(searchParams)
      next.delete('new')
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, showModal, setSearchParams]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const updateItem = (i, k, v) => setLineItems(items => {
    const n = [...items]
    n[i] = { ...n[i], [k]: v }
    if (k === 'qty' || k === 'unit_price') n[i].subtotal = (Number(n[i].qty) || 0) * (Number(n[i].unit_price) || 0)
    return n
  })

  const handleSubmit = async () => {
    if (!validateRequired(form, ['employee', 'category', 'date', 'description'], setErrors)) return
    const total = lineItems.reduce((s, li) => s + (li.subtotal || 0), 0)
    if (total <= 0) { toast.warning('請至少填一筆品項（含數量及單價）'); return }
    const validItems = lineItems.filter(li => li.name || Number(li.unit_price) > 0)
    const payload = { ...form, amount: total, items: validItems }

    // ── 編輯重送路徑 ──
    if (editingId) {
      const { error: updErr } = await supabase.from('expenses')
        .update({ ...payload, status: '待審核', reject_reason: null })
        .eq('id', editingId)
      if (updErr) { toast.error('更新失敗：' + updErr.message); return }
      // 同步附件：保留沒被移除的 URL + 上傳新增的檔案
      const keptUrls = cloneSourceAtts.filter(u => typeof u === 'string')
      let allUrls = [...keptUrls]
      if (attachFiles.length > 0) {
        const empRow = employees.find(e2 => e2.name === form.employee)
        const newUrls = []
        for (const { file } of attachFiles) {
          const ext = (file.name.split('.').pop() || 'bin').toLowerCase()
          const path = `emp-${empRow?.id || 'unknown'}/${editingId}-${Date.now()}.${ext}`
          const { error: upErr } = await supabase.storage.from('expense-receipts').upload(path, file, { cacheControl: '3600', upsert: true })
          if (!upErr) {
            const { data: urlData } = supabase.storage.from('expense-receipts').getPublicUrl(path)
            if (urlData?.publicUrl) newUrls.push(urlData.publicUrl)
          }
        }
        allUrls = [...keptUrls, ...newUrls]
        setAttachFiles([])
      }
      await supabase.from('expenses').update({ attachments: allUrls }).eq('id', editingId)
      try {
        const { error: rpcErr } = await supabase.rpc('resume_workflow_for_request', { p_type: 'expense', p_id: editingId })
        if (rpcErr) {
          console.error('[resume_workflow] error:', rpcErr)
          toast.error('簽核流程重啟失敗：' + rpcErr.message)
        }
      } catch (e) {
        console.error('[resume_workflow] failed:', e)
        toast.error('簽核流程重啟失敗：' + (e.message || '未知錯誤'))
      }
      setExpenses(prev => prev.map(x => x.id === editingId ? { ...x, ...payload, status: '待審核', reject_reason: null, attachments: allUrls } : x))
      setShowModal(false)
      setEditingId(null)
      setCloneSourceAtts([])
      setForm({ employee: profile?.name || employees[0]?.name || '', category: CATEGORIES[0], date: '', description: '', receipt: true })
      setLineItems([emptyItem()])
      return
    }

    // ── 新增路徑 ──
    // 從 URL 取 binding_id（任務頁帶過來的）
    const bindingId = searchParams.get('binding_id')
    // ★ 修：補 organization_id + employee_id。沒帶 org → auto-apply 簽核鏈直接 bail（org IS NULL 就 return）
    //   → approval_chain_id 留 null → guard「尚未設定費用報銷簽核鏈」擋掉 insert（原本錯誤又被吞掉 → 沒紀錄）
    const fullPayload = {
      ...payload,
      status: '待審核',
      organization_id: profile?.organization_id ?? null,
      employee_id: employees.find(e2 => e2.name === form.employee)?.id ?? null,
    }
    if (bindingId) fullPayload.linked_binding_id = Number(bindingId)
    const { data, error: insErr } = await createExpense(fullPayload)
    if (insErr) { toast.error('送出失敗：' + insErr.message); return }
    if (data) {
      setExpenses(prev => [...prev, data])
      // 附件上傳（與 LIFF 同 bucket）
      const empRow = employees.find(e2 => e2.name === form.employee)
      if (attachFiles.length > 0) {
        await uploadAttachments(data.id, empRow?.id)
      }
      // 複製重送：把來源單的附件 storage 檔複製一份到新單（各自獨立，不動原單）
      if (cloneSourceAtts.length > 0) {
        const newUrls = []
        for (const url of cloneSourceAtts) {
          const m = String(url).match(/\/expense-receipts\/(.+)$/)
          if (!m) { newUrls.push(url); continue }
          const oldPath = decodeURIComponent(m[1].split('?')[0])
          const ext = (oldPath.split('.').pop() || 'bin').toLowerCase()
          const newPath = `emp-${empRow?.id || 'x'}/${data.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
          const { error: cpErr } = await supabase.storage.from('expense-receipts').copy(oldPath, newPath)
          newUrls.push(cpErr ? url : supabase.storage.from('expense-receipts').getPublicUrl(newPath).data.publicUrl)
        }
        if (newUrls.length) await supabase.from('expenses').update({ attachments: newUrls }).eq('id', data.id)
        setCloneSourceAtts([])
      }
      setShowModal(false)
      setAttachFiles([])
      setLineItems([emptyItem()])
      setForm({ employee: profile?.name || employees[0]?.name || '', category: CATEGORIES[0], date: '', description: '', receipt: true })
      await createApprovalWorkflow('expense', data, form.employee)
      postBindingFillDone(bindingId ? Number(bindingId) : null)  // 任務 iframe inline：通知父視窗完成
    }
  }

  const handleApprove = async (id) => {
    const { data } = await updateExpenseStatus(id, '已核銷')
    if (data) {
      setExpenses(prev => prev.map(e => e.id === id ? data : e))
      getEventBus().publish('hr.expense.approved', {
        expense_id: data.id,
        employee: data.employee,
        category: data.category,
        amount: data.amount,
        description: data.description,
        date: data.date,
      }, { source: 'Expenses.jsx' })
      toast.success('已驗收')
    }
  }

  const handleReject = async (id, reasonArg) => {
    const reason = reasonArg ?? prompt('請輸入駁回原因：')
    if (reason === null) return
    if (!reason.trim()) { toast.warning('請填寫駁回原因'); return }
    const { data } = await updateExpenseStatus(id, '已駁回', reason.trim())
    if (data) setExpenses(prev => prev.map(e => e.id === id ? data : e))
  }

  const handleDelete = async (row) => {
    if (!(await confirm({ message: '確定永久刪除此申請？此操作無法復原。' }))) return
    const { error } = await supabase.from('expenses').delete().eq('id', row.id)
    if (error) { toast.error('刪除失敗：' + error.message); return }
    toast.success('已刪除')
    setExpenses(prev => prev.filter(x => x.id !== row.id))
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const getEmpDept = (name) => employees.find(e => e.name === name)?.dept || ''

  const printWithChain = async (row) => {
    if (!employees.length) { toast.error('員工清單載入中，請稍候'); return }
    const win = window.open('', '_blank', 'width=900,height=1100')
    if (!win) { toast.error('請允許彈出視窗才能列印簽呈'); return }
    try {
      const empRow = employees.find(e => e.name === row.employee)
      const chainSteps = await buildFormChainSteps({
        formType: 'expense',
        organizationId: profile?.organization_id,
        applicantName: row.employee,
        applicantId: empRow?.id,
        applicantCreatedAt: row.created_at,
        recordStatus: row.status,
        approverName: row.approver,
        approvedAt: row.approved_at,
        rejectReason: row.reject_reason,
        fallbackTail: ['財務核章'],
      })
      const approverMap = {}
      chainSteps.forEach(s => { if (s.target_emp_id && s.name) approverMap[s.target_emp_id] = s.name })
      printExpenseSimpleSignOff(row, {
        companyName: organization?.name, logoUrl: organization?.logo_url,
        dept: getEmpDept(row.employee),
        signatures: Object.fromEntries(employees.filter(emp => emp.signature_url).map(emp => [emp.name, emp.signature_url])),
        chainSteps,
        approverMap,
        _win: win,
      })
    } catch (e) {
      win.close()
      toast.error('產生簽呈失敗：' + (e.message || '未知錯誤'))
    }
  }

  const openDetail = async (row) => {
    detailRowIdRef.current = row.id
    setDetailRow(row)
    setLoadingChain(true)
    setDetailChainSteps([])
    const empRow = employees.find(e => e.name === row.employee)
    const steps = await buildFormChainSteps({
      formType: 'expense',
      organizationId: profile?.organization_id,
      applicantName: row.employee,
      applicantId: empRow?.id,
      applicantCreatedAt: row.created_at,
      recordStatus: row.status,
      approverName: row.approver,
      approvedAt: row.approved_at,
      rejectReason: row.reject_reason,
      fallbackTail: ['財務核章'],
    })
    if (detailRowIdRef.current !== row.id) return
    setDetailChainSteps(steps)
    setLoadingChain(false)
  }

  const q = searchQuery.trim().toLowerCase()
  const filtered = expenses
    .filter(e => {
      if (deptFilter && getEmpDept(e.employee) !== deptFilter) return false
      if (q) {
        const expNo = `EXP-${String(e.id).padStart(4, '0')}`
        return (
          expNo.toLowerCase().includes(q) ||
          (e.employee || '').toLowerCase().includes(q) ||
          (e.category || '').toLowerCase().includes(q) ||
          (e.description || '').toLowerCase().includes(q)
        )
      }
      return true
    })
    .sort((a, b) => {
      const da = (a.date || '').localeCompare(b.date || '')
      return dateSort === 'asc' ? da : -da
    })


  const totalPending = filtered.filter(e => e.status === '待審核').reduce((s, e) => s + Number(e.amount), 0)
  const totalApproved = filtered.filter(e => e.status === '已核銷').reduce((s, e) => s + Number(e.amount), 0)

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">🧾</span> 經常性費用報銷</h2>
            <p>日常營運而週期性發生的常態支出</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {hasPermission('finance.edit') && (
              <button className="btn btn-secondary" onClick={() => navigate('/process/settings/chains/edit?formType=expense&label=經常性費用報銷')} title="設定經常性費用報銷簽核流程">
                <Settings size={14} /> 簽核設定
              </button>
            )}
            <button className="btn btn-primary" onClick={() => {
              setEditingId(null)
              setForm({ employee: profile?.name || employees[0]?.name || '', category: CATEGORIES[0], date: '', description: '', receipt: true })
              setLineItems([emptyItem()])
              setErrors({})
              setShowModal(true)
            }}><Plus size={14} /> 新增申請</button>
          </div>
        </div>
      </div>

      {/* 篩選列 */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        {/* 搜尋欄（同非經常性費用樣式）*/}
        <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
          <Search size={13} style={{ position: 'absolute', left: 8, color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="搜尋編號 / 員工 / 科目 / 說明"
            style={{ paddingLeft: 26, paddingRight: searchQuery ? 26 : 10, paddingTop: 5, paddingBottom: 5, borderRadius: 6, border: '1px solid var(--border-medium)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13, outline: 'none', width: 220 }}
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} style={{ position: 'absolute', right: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
              <X size={12} />
            </button>
          )}
        </div>
        {/* 部門篩選 */}
        <select className="form-input" style={{ fontSize: 13, minWidth: 140 }} value={deptFilter} onChange={e => setDeptFilter(e.target.value)}>
          <option value="">全部部門</option>
          {departments.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
        </select>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">待審核</div>
          <div className="stat-card-value">{filtered.filter(e => e.status === '待審核').length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">已驗收金額</div>
          <div className="stat-card-value">NT$ {totalApproved.toLocaleString()}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">待驗收金額</div>
          <div className="stat-card-value">NT$ {totalPending.toLocaleString()}</div>
        </div>
      </div>

      <div className="card">
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead><tr>
              <th>編號</th><th>員工</th><th>部門</th><th>會計科目</th><th>金額</th>
              <th style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
                onClick={() => setDateSort(s => s === 'desc' ? 'asc' : 'desc')}>
                日期 {dateSort === 'desc' ? <ArrowDown size={11} style={{ verticalAlign: -1 }} /> : <ArrowUp size={11} style={{ verticalAlign: -1 }} />}
              </th>
              <th>說明</th><th>收據</th><th>狀態</th><th>操作</th>
            </tr></thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無申請</td></tr>}
              {filtered.map(e => (
                <tr key={e.id} onClick={() => openDetail(e)} style={{ cursor: 'pointer' }} title="點擊查看簽核明細"
                  onMouseEnter={(ev) => ev.currentTarget.style.background = 'var(--bg-secondary)'}
                  onMouseLeave={(ev) => ev.currentTarget.style.background = ''}>
                  <td><span style={{ fontFamily: 'monospace', fontSize: 11, padding: '2px 6px', borderRadius: 4, background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)', fontWeight: 600 }}>EXP-{String(e.id).padStart(4, '0')}</span></td>
                  <td style={{ fontWeight: 600 }}>{e.employee}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{getEmpDept(e.employee) || '-'}</td>
                  <td><span className="badge badge-info">{e.category}</span></td>
                  <td style={{ fontWeight: 600 }}>NT$ {Number(e.amount).toLocaleString()}</td>
                  <td>{e.date}</td>
                  <td>{e.description}</td>
                  <td>{e.receipt ? <span className="badge badge-success">✓ 有</span> : <span className="badge badge-danger">✗ 無</span>}</td>
                  <td>
                    <span className={`badge ${e.status === '已核銷' ? 'badge-success' : e.status === '已駁回' ? 'badge-danger' : 'badge-warning'}`}>
                      <span className="badge-dot"></span>{e.status === '已核銷' ? '已驗收' : e.status}
                    </span>
                    {e.reject_reason && (
                      <div style={{ fontSize: 11, color: 'var(--accent-red)', marginTop: 4 }}>原因：{e.reject_reason}</div>
                    )}
                  </td>
                  <td onClick={(ev) => ev.stopPropagation()}>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {e.status === '待審核' && canApprove('expenses', e.id) && (
                        <span style={{ fontSize: 11, color: 'var(--accent-cyan)', fontWeight: 600 }}>點明細簽核</span>
                      )}
                      {['待審核','申請中','已駁回','已退回'].includes(e.status) && e.employee === profile?.name && (
                        <button className="btn btn-sm btn-primary" style={{ background: 'var(--accent-orange)' }} onClick={() => {
                          setEditingId(e.id)
                          setCloneSourceAtts(Array.isArray(e.attachments) ? e.attachments : [])
                          setForm({
                            employee: e.employee,
                            category: e.category || CATEGORIES[0],
                            date: e.date || '',
                            description: e.description || '',
                            receipt: e.receipt ?? true,
                          })
                          setLineItems(Array.isArray(e.items) && e.items.length ? e.items : [{ name: e.description || '', qty: 1, unit_price: e.amount || 0, subtotal: Number(e.amount) || 0 }])
                          setShowModal(true)
                        }}>✏️ {(e.status === '已駁回' || e.status === '已退回') ? '編輯重送' : '編輯'}</button>
                      )}
                      {e.employee === profile?.name && (
                        <button className="btn btn-sm btn-secondary" style={{ color: 'var(--accent-cyan)' }} title="以這張為範本開一張全新報銷（含附件，不動原單）" onClick={() => {
                          setEditingId(null)
                          setCloneSourceAtts(Array.isArray(e.attachments) ? e.attachments : [])
                          setForm({
                            employee: e.employee,
                            category: e.category || CATEGORIES[0],
                            date: e.date || '',
                            description: e.description || '',
                            receipt: e.receipt ?? true,
                          })
                          setLineItems(Array.isArray(e.items) && e.items.length ? e.items : [{ name: e.description || '', qty: 1, unit_price: e.amount || 0, subtotal: Number(e.amount) || 0 }])
                          setShowModal(true)
                        }}>📋 複製</button>
                      )}
                      <button className="btn btn-sm btn-secondary" title="下載簽呈"
                        onClick={() => printWithChain(e)}>
                        <Printer size={11} />
                      </button>
                      {canDeleteAll && (
                        <button className="btn btn-sm btn-secondary" style={{ fontSize: 11, padding: '3px 8px', color: 'var(--accent-red)' }} onClick={() => handleDelete(e)} title="永久刪除">
                          刪除
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <Modal
          title={editingId ? '✏️ 編輯重送（駁回後修改）' : '新增經常性費用報銷'}
          onClose={() => { setShowModal(false); setErrors({}); setEditingId(null); setCloneSourceAtts([]) }}
          onSubmit={handleSubmit}
          successMessage={editingId ? '已重新送審，主管會收到通知' : '經常性費用報銷已送出，等待主管簽核'}
        >
          <Field label="員工" required error={errors.employee} errorMsg="請選擇員工">
            <SearchableSelect
              value={form.employee}
              onChange={(v) => { set('employee', v || ''); clearError('employee', setErrors) }}
              options={empOptions(employees, { keyBy: 'name' })}
              placeholder="搜尋員工姓名/職稱..."
            />
          </Field>
          <Field label="會計科目" required error={errors.category} errorMsg="請選會計科目">
            <select className="form-input" style={{ width: '100%' }} value={form.category} onChange={e => { set('category', e.target.value); clearError('category', setErrors) }}>
              <option value="">— 請選擇會計科目 —</option>
              {(accounts.length > 0
                ? accounts.map(a => <option key={a.id ?? a.code} value={a.name}>{a.code} {a.name}</option>)
                : CATEGORIES.map(c => <option key={c} value={c}>{c}</option>))}
            </select>
          </Field>
          <Field label="品項明細" required>
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 72px 88px 72px 24px', gap: 4, marginBottom: 4 }}>
                {['品名', '數量', '單價', '小計', ''].map((h, i) => (
                  <div key={i} style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, paddingLeft: 2 }}>{h}</div>
                ))}
              </div>
              {lineItems.map((li, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 72px 88px 72px 24px', gap: 4, marginBottom: 6, alignItems: 'center' }}>
                  <input className="form-input" style={{ fontSize: 13 }} type="text" placeholder="品名" value={li.name} onChange={e => updateItem(i, 'name', e.target.value)} />
                  <input className="form-input" style={{ fontSize: 13 }} type="number" placeholder="1" inputMode="decimal" value={li.qty} onChange={e => updateItem(i, 'qty', e.target.value)} />
                  <input className="form-input" style={{ fontSize: 13 }} type="number" placeholder="0" inputMode="decimal" value={li.unit_price} onChange={e => updateItem(i, 'unit_price', e.target.value)} />
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', textAlign: 'right', paddingRight: 2 }}>
                    {li.subtotal ? `NT$${Number(li.subtotal).toLocaleString()}` : '-'}
                  </div>
                  <button type="button" onClick={() => setLineItems(prev => prev.length > 1 ? prev.filter((_, j) => j !== i) : prev)}
                    style={{ background: 'none', border: 'none', cursor: lineItems.length > 1 ? 'pointer' : 'default', color: lineItems.length > 1 ? 'var(--accent-red)' : 'transparent', padding: 0, fontSize: 16, lineHeight: 1 }}>×</button>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                <button type="button" className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 10px' }}
                  onClick={() => setLineItems(prev => [...prev, emptyItem()])}>
                  <Plus size={11} /> 新增品項
                </button>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-cyan)' }}>
                  合計：NT$ {lineItems.reduce((s, li) => s + (li.subtotal || 0), 0).toLocaleString()}
                </span>
              </div>
            </div>
          </Field>
          <Field label="日期" required error={errors.date} errorMsg="請選日期">
            <input className="form-input" type="date" style={{ width: '100%' }} value={form.date} onChange={e => { set('date', e.target.value); clearError('date', setErrors) }} />
          </Field>
          <Field label="說明" required error={errors.description} errorMsg="請填寫費用說明">
            <input className="form-input" type="text" style={{ width: '100%' }} placeholder="費用說明" value={form.description} onChange={e => { set('description', e.target.value); clearError('description', setErrors) }} />
          </Field>
          <Field label="收據">
            <select className="form-input" style={{ width: '100%' }} value={form.receipt} onChange={e => set('receipt', e.target.value === 'true')}>
              <option value="true">有收據</option>
              <option value="false">無收據</option>
            </select>
          </Field>
          <Field label="收據附件（最多 5 個）">
            <div>
              <CarriedAttachments
                atts={cloneSourceAtts.map(url => ({ url, file_name: decodeURIComponent(String(url).split('?')[0].split('/').pop() || '附件') }))}
                onRemove={(i) => setCloneSourceAtts(prev => prev.filter((_, j) => j !== i))}
              />
              <input type="file" multiple accept="image/*,application/pdf"
                onChange={handleFileSelect}
                style={{ fontSize: 12 }}
              />
              {attachFiles.length > 0 && (
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {attachFiles.map((a, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '4px 8px', background: 'var(--bg-secondary)', borderRadius: 6 }}>
                      <Paperclip size={11} />
                      <span style={{ flex: 1 }}>{a.file.name}</span>
                      <button type="button" onClick={() => removeAttach(i)}
                        style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: 0 }}>✕</button>
                    </div>
                  ))}
                </div>
              )}
              {uploading && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>📤 上傳中…</div>}
            </div>
          </Field>
        </Modal>
      )}

      {detailRow && (() => {
        const empRow = employees.find(e => e.name === detailRow.employee)
        return (
          <ApprovalDetailModal
            open={!!detailRow}
            onClose={() => { setDetailRow(null); setDetailChainSteps([]) }}
            docTitle="經常性費用報銷"
            docNo={detailRow.id}
            status={detailRow.status}
            applicant={{
              name: detailRow.employee,
              name_en: empRow?.name_en,
              position: empRow?.position,
              dept: getEmpDept(detailRow.employee),
              status: empRow?.status,
              employee_no: empRow?.employee_no,
            }}
            fields={[
              { label: '會計科目', value: detailRow.category },
              { label: '發生日期', value: detailRow.date },
              { label: '金額', value: `NT$ ${Number(detailRow.amount || 0).toLocaleString()}` },
              { label: '是否有收據', value: detailRow.receipt ? '有' : '無' },
              { label: '用途', value: detailRow.description, multiline: true },
              ...(detailRow.reject_reason ? [{ label: '駁回原因', value: detailRow.reject_reason, multiline: true }] : []),
            ]}
            attachments={(detailRow.attachments || []).map(url => ({
              url,
              name: decodeURIComponent(url.split('?')[0].split('/').pop() || '附件'),
            }))}
            createdAt={detailRow.created_at}
            chainSteps={loadingChain ? [{ label: '載入中…', name: '', status: 'pending' }] : detailChainSteps}
            requestType="expense"
            requestId={detailRow.id}
            onPrint={() => printWithChain(detailRow)}
            actions={
              detailRow.status === '待審核' && canApprove('expenses', detailRow.id) ? {
                sourceTable: 'expenses',
                row: detailRow,
                onApprove: async () => handleApprove(detailRow.id),
                onReject: async (_r, reason) => handleReject(detailRow.id, reason),
                onChanged: () => { load(); setDetailRow(null); returnNav() },
                approveLabel: '驗收',
              } : null
            }
          />
        )
      })()}

    </div>
  )
}
