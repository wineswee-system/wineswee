import { useState, useEffect, useMemo } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Plus, Search, X as XIcon, Send, Inbox, List, Flag, Building2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import AsyncButton from '../../components/AsyncButton'
import Modal, { Field } from '../../components/Modal'
import SearchableSelect, { empOptions } from '../../components/SearchableSelect'
import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'

const PRIORITY = {
  high:   { label: '高', color: 'var(--accent-red)',    dim: 'var(--accent-red-dim)' },
  medium: { label: '中', color: 'var(--accent-orange)', dim: 'var(--accent-orange-dim)' },
  low:    { label: '低', color: 'var(--accent-blue)',   dim: 'var(--accent-blue-dim)' },
}
const STATUS = {
  待受理: { color: 'var(--accent-orange)', dim: 'var(--accent-orange-dim)' },
  處理中: { color: 'var(--accent-blue)',   dim: 'var(--accent-blue-dim)' },
  已完成: { color: 'var(--accent-cyan)',   dim: 'var(--accent-cyan-dim)' },
  已結案: { color: 'var(--accent-green)',  dim: 'var(--accent-green-dim)' },
  已退回: { color: 'var(--accent-red)',    dim: 'var(--accent-red-dim)' },
}

export default function WorkOrders() {
  const { profile, hasPermission } = useAuth()
  const orgId = profile?.organization_id
  const isAdmin = hasPermission?.('system.admin') || ['super_admin', 'admin'].includes(profile?.role)

  const [me, setMe] = useState(null)          // { id, department_id }
  const [orders, setOrders] = useState([])
  const [departments, setDepartments] = useState([])
  const [employees, setEmployees] = useState([])
  const [stores, setStores] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('sent')       // sent | inbox | all
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [detail, setDetail] = useState(null)
  const [searchParams, setSearchParams] = useSearchParams()

  const emptyForm = { target_department_id: '', assignee_id: '', title: '', description: '', priority: 'medium', expected_due_date: '', store_id: '' }
  const [form, setForm] = useState(emptyForm)

  const load = async () => {
    if (!orgId) return
    const [meRes, oRes, dRes, eRes, sRes] = await Promise.all([
      supabase.from('employees').select('id, department_id').eq('id', profile?.id).maybeSingle(),
      supabase.from('work_orders').select('*').is('deleted_at', null).order('id', { ascending: false }),
      supabase.from('departments').select('id, name').eq('organization_id', orgId).order('name'),
      supabase.from('employees').select('id, name, department_id, position').eq('organization_id', orgId).eq('status', '在職').order('name'),
      supabase.from('stores').select('id, name').eq('organization_id', orgId).order('name'),
    ])
    setMe(meRes.data || null)
    setOrders(oRes.data || [])
    setDepartments(dRes.data || [])
    setEmployees(eRes.data || [])
    setStores(sRes.data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [orgId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ?focus=ID 自動開明細（從別處跳進來）
  useEffect(() => {
    const f = searchParams.get('focus')
    if (!f || !orders.length) return
    const row = orders.find(o => o.id === Number(f))
    if (row) { setDetail(row); setSearchParams(sp => { const x = new URLSearchParams(sp); x.delete('focus'); return x }, { replace: true }) }
  }, [orders, searchParams]) // eslint-disable-line react-hooks/exhaustive-deps

  const myId = me?.id
  const myDept = me?.department_id

  const tabbed = useMemo(() => {
    if (tab === 'sent') return orders.filter(o => o.requester_id === myId)
    if (tab === 'inbox') return orders.filter(o => o.target_department_id === myDept)
    return orders
  }, [orders, tab, myId, myDept])

  const filtered = tabbed.filter(o => !search.trim() ||
    [String(o.id), o.title, o.target_department_name, o.requester_name, o.assignee_name].some(v => (v || '').toLowerCase().includes(search.trim().toLowerCase())))

  const inboxOpen = orders.filter(o => o.target_department_id === myDept && ['待受理', '處理中'].includes(o.status)).length

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const submitCreate = async () => {
    if (!form.target_department_id) { toast.warning('請選目標部門'); return false }
    if (!form.title.trim()) { toast.warning('請填主旨'); return false }
    if (!form.expected_due_date) { toast.warning('請選期望完成日'); return false }
    const { data, error } = await supabase.rpc('create_work_order', {
      p_target_department_id: Number(form.target_department_id),
      p_title: form.title.trim(),
      p_description: form.description.trim(),
      p_priority: form.priority,
      p_expected_due_date: form.expected_due_date,
      p_store_id: form.store_id ? Number(form.store_id) : null,
      p_assignee_id: form.assignee_id ? Number(form.assignee_id) : null,
    })
    if (error) { toast.error('開單失敗：' + error.message); return false }
    if (!data?.ok) { toast.error('開單失敗：' + (data?.error || '未知')); return false }
    toast.success('工單已送出')
    setShowCreate(false)
    setForm(emptyForm)
    load()
  }

  if (loading) return <LoadingSpinner />

  const deptName = (id) => departments.find(d => d.id === id)?.name || '—'
  const TABS = [
    { key: 'sent',  label: '我發出的', icon: Send },
    { key: 'inbox', label: `待我部門處理${inboxOpen ? ` (${inboxOpen})` : ''}`, icon: Inbox },
    { key: 'all',   label: '全部', icon: List },
  ]

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><Building2 size={20} style={{ verticalAlign: -3, marginRight: 6, color: 'var(--accent-blue)' }} />跨部門工單</h2>
            <p>請其他部門協助處理事項 · 受理排程 · 完成結案（純流程紀錄，不走簽核）</p>
          </div>
          <button className="btn btn-primary" onClick={() => { setForm(emptyForm); setShowCreate(true) }}><Plus size={14} /> 新增工單</button>
        </div>
      </div>

      {/* tabs + search */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {TABS.map(t => {
            const Icon = t.icon
            const on = tab === t.key
            return (
              <button key={t.key} onClick={() => setTab(t.key)} style={{
                display: 'flex', alignItems: 'center', gap: 5, padding: '7px 14px', borderRadius: 8, cursor: 'pointer',
                fontSize: 13, fontWeight: 600, border: `1px solid ${on ? 'var(--accent-cyan)' : 'var(--border-medium)'}`,
                background: on ? 'var(--accent-cyan-dim)' : 'var(--bg-card)', color: on ? 'var(--accent-cyan)' : 'var(--text-secondary)',
              }}><Icon size={13} /> {t.label}</button>
            )
          })}
        </div>
        <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', marginLeft: 'auto' }}>
          <Search size={13} style={{ position: 'absolute', left: 8, color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜尋主旨/部門/人"
            style={{ paddingLeft: 26, paddingRight: search ? 26 : 10, paddingTop: 6, paddingBottom: 6, borderRadius: 8, border: '1px solid var(--border-medium)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13, outline: 'none', width: 200 }} />
          {search && <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}><XIcon size={12} /></button>}
        </div>
      </div>

      <div className="card">
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead><tr>
              <th style={{ width: 55 }}>單號</th><th>主旨</th>
              <th>{tab === 'sent' ? '目標部門' : '申請'}</th>
              <th>承辦人</th><th>優先</th><th>期望 / 排定</th><th>狀態</th>
            </tr></thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>
                {tab === 'sent' ? '你還沒開過工單' : tab === 'inbox' ? '目前沒有待你部門處理的工單 🎉' : '尚無工單'}
              </td></tr>}
              {filtered.map(o => {
                const pr = PRIORITY[o.priority] || PRIORITY.medium
                const st = STATUS[o.status] || {}
                return (
                  <tr key={o.id} onClick={() => setDetail(o)} style={{ cursor: 'pointer' }} title="點擊查看 / 處理"
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-secondary)'}
                    onMouseLeave={e => e.currentTarget.style.background = ''}>
                    <td style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)' }}>#{o.id}</td>
                    <td style={{ fontWeight: 600, maxWidth: 260 }}>{o.title}</td>
                    <td style={{ fontSize: 12 }}>
                      {tab === 'sent'
                        ? <><Building2 size={11} style={{ verticalAlign: -1, marginRight: 3, color: 'var(--text-muted)' }} />{o.target_department_name}</>
                        : <span style={{ color: 'var(--text-muted)' }}>{o.requester_department_name} · {o.requester_name}</span>}
                    </td>
                    <td style={{ fontSize: 12 }}>{o.assignee_name || <span style={{ color: 'var(--text-muted)' }}>未指派</span>}</td>
                    <td><span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: pr.dim, color: pr.color }}>{pr.label}</span></td>
                    <td style={{ fontSize: 11 }}>
                      <div>{o.expected_due_date}</div>
                      {o.scheduled_due_date && o.scheduled_due_date !== o.expected_due_date &&
                        <div style={{ color: 'var(--accent-blue)' }}>排 {o.scheduled_due_date}</div>}
                    </td>
                    <td><span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 6, background: st.dim, color: st.color }}>{o.status}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showCreate && (
        <Modal title="新增跨部門工單" onClose={() => setShowCreate(false)} onSubmit={submitCreate} successMessage="工單已送出，等待目標部門受理">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="目標部門" required>
              <select className="form-input" style={{ width: '100%' }} value={form.target_department_id} onChange={e => set('target_department_id', e.target.value)}>
                <option value="">請選擇…</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
            <Field label="指定承辦人（選填）">
              <SearchableSelect
                value={form.assignee_id ? String(form.assignee_id) : ''}
                onChange={v => set('assignee_id', v || '')}
                options={empOptions(employees.filter(e => !form.target_department_id || e.department_id === Number(form.target_department_id)), { keyBy: 'id' })}
                placeholder="不填 = 交目標部門分派"
              />
            </Field>
          </div>
          <Field label="主旨" required>
            <input className="form-input" style={{ width: '100%' }} placeholder="例：中秋檔期門市海報設計" value={form.title} onChange={e => set('title', e.target.value)} />
          </Field>
          <Field label="詳細說明">
            <textarea className="form-input" style={{ width: '100%', minHeight: 80, resize: 'vertical' }} placeholder="具體需求、規格、數量、用途…" value={form.description} onChange={e => set('description', e.target.value)} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Field label="優先級" required>
              <select className="form-input" style={{ width: '100%' }} value={form.priority} onChange={e => set('priority', e.target.value)}>
                <option value="high">高</option><option value="medium">中</option><option value="low">低</option>
              </select>
            </Field>
            <Field label="期望完成日" required>
              <input type="date" className="form-input" style={{ width: '100%' }} value={form.expected_due_date} onChange={e => set('expected_due_date', e.target.value)} />
            </Field>
            <Field label="關聯門市（選填）">
              <select className="form-input" style={{ width: '100%' }} value={form.store_id} onChange={e => set('store_id', e.target.value)}>
                <option value="">無</option>
                {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
          </div>
        </Modal>
      )}

      {detail && (
        <WorkOrderDetail
          order={detail} me={me} isAdmin={isAdmin} employees={employees}
          storeName={(id) => stores.find(s => s.id === id)?.name || `#${id}`}
          onClose={() => setDetail(null)}
          onChanged={() => { setDetail(null); load() }}
        />
      )}
    </div>
  )
}

// ── 明細 + 動作 ──
function WorkOrderDetail({ order: o, me, isAdmin, employees, storeName, onClose, onChanged }) {
  const navigate = useNavigate()
  const [accepting, setAccepting] = useState(false)
  const [acceptForm, setAcceptForm] = useState({ assignee_id: o.assignee_id ? String(o.assignee_id) : '', scheduled_due_date: o.scheduled_due_date || o.expected_due_date || '' })

  const myId = me?.id, myDept = me?.department_id
  const isRequester = o.requester_id === myId
  const isTargetDept = o.target_department_id === myDept
  const isAssignee = o.assignee_id === myId
  const pr = PRIORITY[o.priority] || PRIORITY.medium
  const st = STATUS[o.status] || {}

  const call = async (rpc, args, okMsg) => {
    const { data, error } = await supabase.rpc(rpc, args)
    if (error) { toast.error(error.message); return }
    if (!data?.ok) {
      const map = { NOT_AUTHORIZED: '你沒有權限做此動作', NOT_PENDING: '此單已被受理', NOT_IN_PROGRESS: '狀態不是處理中', NOT_COMPLETED: '尚未回報完成', BAD_STATUS: '目前狀態不可執行', NOT_FOUND: '找不到工單' }
      toast.error(map[data?.error] || data?.error || '操作失敗'); return
    }
    toast.success(okMsg); onChanged()
  }

  const doAccept = async () => {
    if (!acceptForm.scheduled_due_date) { toast.warning('請填排定完成日'); return }
    await call('accept_work_order', {
      p_id: o.id,
      p_assignee_id: acceptForm.assignee_id ? Number(acceptForm.assignee_id) : null,
      p_scheduled_due_date: acceptForm.scheduled_due_date,
    }, '已受理，進入處理中')
  }
  const doReject = async () => {
    const reason = window.prompt('退回原因：')
    if (reason === null) return
    await call('reject_work_order', { p_id: o.id, p_reason: reason }, '已退回')
  }
  const toProject = async () => {
    if (!(await confirm({ message: '把這張工單轉成「專案」執行？轉了之後，工單完成改由專案內所有任務完成後自動關閉，不能再手動回報完成。' }))) return
    const { data, error } = await supabase.rpc('convert_work_order_to_project', { p_id: o.id })
    if (error) { toast.error(error.message); return }
    if (!data?.ok) { toast.error(data?.error === 'ALREADY_LINKED' ? '已經綁過了' : data?.error || '轉換失敗'); return }
    toast.success('已轉為專案，接著到專案加任務')
    navigate(`/process/projects?focus=${data.project_id}`)
  }
  const toWorkflow = () => {
    // 導到工作流部署精靈,帶工單 id → 部署完成後回填綁定
    navigate(`/process/workflows?link_work_order=${o.id}`)
  }

  const Row = ({ label, children }) => (
    <div style={{ display: 'flex', gap: 10, padding: '6px 0', borderBottom: '1px solid var(--border-subtle)' }}>
      <div style={{ width: 90, flexShrink: 0, fontSize: 12, color: 'var(--text-muted)' }}>{label}</div>
      <div style={{ fontSize: 13, color: 'var(--text-primary)', flex: 1 }}>{children}</div>
    </div>
  )

  return (
    <Modal title={`工單 #${o.id}`} onClose={onClose}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 6, background: st.dim, color: st.color }}>{o.status}</span>
        <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: pr.dim, color: pr.color }}>優先：{pr.label}</span>
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>{o.title}</div>

      <Row label="申請">{o.requester_department_name} · {o.requester_name}</Row>
      <Row label="目標部門"><Building2 size={12} style={{ verticalAlign: -1, marginRight: 4, color: 'var(--accent-blue)' }} />{o.target_department_name}</Row>
      <Row label="承辦人">{o.assignee_name || <span style={{ color: 'var(--text-muted)' }}>未指派</span>}</Row>
      <Row label="期望完成">{o.expected_due_date}</Row>
      <Row label="排定完成">{o.scheduled_due_date || <span style={{ color: 'var(--text-muted)' }}>—（受理時填）</span>}</Row>
      {o.store_id && <Row label="關聯門市">{storeName(o.store_id)}</Row>}
      {o.linked_type && <Row label="執行方式">已轉{o.linked_type === 'project' ? '專案' : '流程'}{(o.linked_project_id || o.linked_workflow_instance_id) ? ` #${o.linked_project_id || o.linked_workflow_instance_id}` : ''}（完成由裡面任務決定）</Row>}
      <Row label="說明"><span style={{ whiteSpace: 'pre-wrap' }}>{o.description || '—'}</span></Row>
      {o.reject_reason && <Row label="退回原因"><span style={{ color: 'var(--accent-red)' }}>{o.reject_reason}</span></Row>}

      {/* ── 動作區（依狀態 + 角色）── */}
      <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* 待受理：目標部門受理 / 退回 */}
        {o.status === '待受理' && (isTargetDept || isAdmin) && (
          accepting ? (
            <div style={{ padding: 12, borderRadius: 8, background: 'var(--bg-secondary)', border: '1px solid var(--border-medium)', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>受理工單</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>指派承辦人</div>
                  <SearchableSelect value={acceptForm.assignee_id} onChange={v => setAcceptForm(f => ({ ...f, assignee_id: v || '' }))}
                    options={empOptions(employees.filter(e => e.department_id === o.target_department_id), { keyBy: 'id' })} placeholder="不填 = 我自己接" />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>排定完成日</div>
                  <input type="date" className="form-input" style={{ width: '100%' }} value={acceptForm.scheduled_due_date} onChange={e => setAcceptForm(f => ({ ...f, scheduled_due_date: e.target.value }))} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <AsyncButton className="btn btn-primary btn-sm" onClick={doAccept} busyLabel="處理中…">確認受理</AsyncButton>
                <button className="btn btn-secondary btn-sm" onClick={() => setAccepting(false)}>取消</button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary btn-sm" onClick={() => setAccepting(true)}><Flag size={13} /> 受理並排程</button>
              <button className="btn btn-secondary btn-sm" style={{ color: 'var(--accent-red)' }} onClick={doReject}>退回</button>
            </div>
          )
        )}

        {/* 處理中：綁了專案/流程 → 顯示連結、完成自動;沒綁 → 回報完成 / 轉專案 / 轉流程 / 退回 */}
        {o.status === '處理中' && (isAssignee || isTargetDept || isAdmin) && (
          o.linked_type ? (
            <div style={{ padding: 12, borderRadius: 8, background: 'var(--accent-blue-dim)', fontSize: 12, color: 'var(--text-secondary)' }}>
              已轉<b>{o.linked_type === 'project' ? '專案' : '流程'}</b>執行 —— 工單完成由裡面任務全數完成後<b>自動關閉</b>，不需（也不能）手動回報。
              <div style={{ marginTop: 8 }}>
                <button className="btn btn-secondary btn-sm" onClick={() => navigate(o.linked_type === 'project' ? `/process/projects?focus=${o.linked_project_id}` : '/process/workflows')}>
                  前往{o.linked_type === 'project' ? '專案' : '流程'}
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <AsyncButton className="btn btn-primary btn-sm" onClick={() => call('complete_work_order', { p_id: o.id }, '已回報完成')} busyLabel="處理中…">回報完成</AsyncButton>
              <button className="btn btn-secondary btn-sm" style={{ color: 'var(--accent-cyan)' }} onClick={toProject}>轉專案執行</button>
              <button className="btn btn-secondary btn-sm" style={{ color: 'var(--accent-purple)' }} onClick={toWorkflow}>轉流程執行</button>
              <button className="btn btn-secondary btn-sm" style={{ color: 'var(--accent-red)' }} onClick={doReject}>退回</button>
            </div>
          )
        )}

        {/* 已完成：申請人確認結案 */}
        {o.status === '已完成' && (isRequester || isAdmin) && (
          <AsyncButton className="btn btn-primary btn-sm" style={{ alignSelf: 'flex-start', background: 'var(--accent-green)' }}
            onClick={() => call('confirm_work_order', { p_id: o.id }, '已結案')} busyLabel="處理中…">確認結案</AsyncButton>
        )}

        {/* 待受理/已退回：申請人可撤單 */}
        {['待受理', '已退回'].includes(o.status) && (isRequester || isAdmin) && (
          <button className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start', color: 'var(--accent-red)' }}
            onClick={async () => { if (await confirm({ message: '撤銷這張工單？' })) call('delete_work_order', { p_id: o.id }, '已撤銷') }}>撤銷工單</button>
        )}
      </div>
    </Modal>
  )
}
