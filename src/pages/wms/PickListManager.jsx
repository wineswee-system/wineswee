import { useState, useEffect, Fragment } from 'react'
import { getWmsPickLists, updateWmsPickList } from '../../lib/db/dispatch'
import { generatePickListFromJobs } from '../../lib/wms/pickListService'
import { useOrgId } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import { toast } from 'sonner'

const STATUS_MAP = {
  pending: '待揀貨',
  in_progress: '揀貨中',
  completed: '已完成',
  short_picked: '缺貨',
}

export default function PickListManager() {
  const orgId = useOrgId()
  const [lists, setLists] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(null)
  const [itemQty, setItemQty] = useState({})
  const [showAssign, setShowAssign] = useState(null)
  const [pickerId, setPickerId] = useState('')
  const [showGenerate, setShowGenerate] = useState(false)
  const [generating, setGenerating] = useState(false)

  const load = async () => {
    setLoading(true)
    const { data } = await getWmsPickLists(orgId)
    setLists(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [orgId])

  const counts = {
    pending: lists.filter(l => l.status === 'pending').length,
    in_progress: lists.filter(l => l.status === 'in_progress').length,
    completed: lists.filter(l => l.status === 'completed').length,
    short_picked: lists.filter(l => l.status === 'short_picked').length,
  }

  const handleAssign = async () => {
    if (!pickerId.trim()) { toast.error('請輸入揀貨員 ID'); return false }
    const { error } = await updateWmsPickList(showAssign, { picker_id: pickerId.trim(), status: 'in_progress' })
    if (error) { toast.error('指派失敗'); return false }
    toast.success('已指派揀貨員')
    setPickerId('')
    setShowAssign(null)
    load()
  }

  const handleComplete = async (id) => {
    const { error } = await updateWmsPickList(id, { status: 'completed', completed_at: new Date().toISOString() })
    if (error) { toast.error('更新失敗'); return }
    toast.success('揀貨完成')
    load()
  }

  const handleItemConfirm = async (list, idx) => {
    const qty = itemQty[list.id + '_' + idx]
    if (qty === undefined || qty === '') { toast.error('請輸入已揀數量'); return }
    const items = (list.items || []).map((it, i) =>
      i === idx ? { ...it, qty_picked: Number(qty) } : it
    )
    const { error } = await updateWmsPickList(list.id, { items })
    if (error) { toast.error('更新失敗'); return }
    toast.success('已更新數量')
    load()
  }

  const handleGenerate = async () => {
    setGenerating(true)
    try {
      await generatePickListFromJobs(orgId)
      toast.success('已自動建立揀貨單')
      setShowGenerate(false)
      load()
    } catch {
      toast.error('建立失敗')
    } finally {
      setGenerating(false)
    }
    return false
  }

  const statusBadge = (status) => {
    const map = {
      pending: 'badge-warning',
      in_progress: 'badge-cyan',
      completed: 'badge-success',
      short_picked: 'badge-danger',
    }
    return <span className={`badge ${map[status] || ''}`}><span className="badge-dot"></span>{STATUS_MAP[status] || status}</span>
  }

  if (loading) return <LoadingSpinner />

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">📋</span> 揀貨單管理</h2>
            <p>倉庫揀貨作業排程與進度追蹤</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowGenerate(true)}>自動建立揀貨單</button>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 20 }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">待揀貨</div>
          <div className="stat-card-value">{counts.pending}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">揀貨中</div>
          <div className="stat-card-value">{counts.in_progress}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">已完成</div>
          <div className="stat-card-value">{counts.completed}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)' }}>
          <div className="stat-card-label">缺貨</div>
          <div className="stat-card-value">{counts.short_picked}</div>
        </div>
      </div>

      <div className="data-table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th>揀貨單號</th>
              <th>批次 ID</th>
              <th>揀貨員</th>
              <th>建立時間</th>
              <th>完成時間</th>
              <th>狀態</th>
              <th>動作</th>
            </tr>
          </thead>
          <tbody>
            {lists.length === 0 ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>尚無揀貨單</td></tr>
            ) : lists.map(list => {
              const isOpen = expanded === list.id
              return (
                <Fragment key={list.id}>
                  <tr>
                    <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>
                      <button
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-cyan)', fontFamily: 'monospace', fontWeight: 600, padding: 0, fontSize: 13 }}
                        onClick={() => setExpanded(isOpen ? null : list.id)}
                      >
                        {isOpen ? '▾' : '▸'} {list.list_number || list.id}
                      </button>
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{list.batch_id || '-'}</td>
                    <td>{list.employees?.name || list.picker_id || '-'}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{list.created_at ? new Date(list.created_at).toLocaleString('zh-TW') : '-'}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{list.completed_at ? new Date(list.completed_at).toLocaleString('zh-TW') : '-'}</td>
                    <td>{statusBadge(list.status)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {list.status === 'pending' && (
                          <button className="btn btn-primary" style={{ padding: '3px 10px', fontSize: 12 }} onClick={() => { setShowAssign(list.id); setPickerId('') }}>指派揀貨員</button>
                        )}
                        {list.status === 'in_progress' && (
                          <button className="btn btn-primary" style={{ padding: '3px 10px', fontSize: 12, background: 'var(--accent-green)' }} onClick={() => handleComplete(list.id)}>完成揀貨</button>
                        )}
                        <button className="btn btn-secondary" style={{ padding: '3px 10px', fontSize: 12 }} onClick={() => setExpanded(isOpen ? null : list.id)}>查看明細</button>
                      </div>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={7} style={{ background: 'var(--bg-secondary)', padding: '10px 16px' }}>
                        <div className="data-table-wrapper" style={{ margin: 0 }}>
                          <table className="data-table" style={{ margin: 0, fontSize: 12 }}>
                            <thead>
                              <tr>
                                <th>SKU 代碼</th>
                                <th>品名</th>
                                <th>應揀數量</th>
                                <th>已揀數量</th>
                                <th>儲位</th>
                                <th>確認</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(list.items || []).length === 0 ? (
                                <tr><td colSpan={6} style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 12 }}>此單無明細</td></tr>
                              ) : (list.items || []).map((item, idx) => {
                                const key = list.id + '_' + idx
                                return (
                                  <tr key={idx}>
                                    <td style={{ fontFamily: 'monospace' }}>{item.sku_code}</td>
                                    <td>{item.name || '-'}</td>
                                    <td>{item.qty_ordered ?? item.qty ?? '-'}</td>
                                    <td>
                                      <input
                                        className="form-input"
                                        type="number"
                                        style={{ width: 72, padding: '2px 6px', fontSize: 12 }}
                                        defaultValue={item.qty_picked ?? 0}
                                        onChange={e => setItemQty(q => ({ ...q, [key]: e.target.value }))}
                                      />
                                    </td>
                                    <td style={{ color: 'var(--text-secondary)' }}>{item.bin_code || '-'}</td>
                                    <td>
                                      <button className="btn btn-primary" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => handleItemConfirm(list, idx)}>確認</button>
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {showAssign && (
        <Modal title="指派揀貨員" onClose={() => setShowAssign(null)} onSubmit={handleAssign} submitLabel="指派">
          <Field label="員工 ID" required>
            <input className="form-input" type="text" style={{ width: '100%' }} placeholder="輸入員工 ID" value={pickerId} onChange={e => setPickerId(e.target.value)} autoFocus />
          </Field>
        </Modal>
      )}

      {showGenerate && (
        <Modal title="自動建立揀貨單" onClose={() => setShowGenerate(false)} onSubmit={handleGenerate} submitLabel={generating ? '建立中…' : '確認建立'} submitDisabled={generating}>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14, margin: 0 }}>
            系統將自動從佇列中的派送任務建立揀貨單，確認後無法撤銷。
          </p>
        </Modal>
      )}
    </div>
  )
}
