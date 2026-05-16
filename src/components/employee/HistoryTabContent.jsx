import { Plus, Trash2 } from 'lucide-react'
import ChangelogPanel from '../ChangelogPanel'

export default function HistoryTabContent({
  subTab,
  isAdmin,
  employee,
  onboardingTasks,
  targetWorkflows,
  targetWfTasks,
  assignments,
  transfers,
  addTransfer,
  reviews,
  addReview,
  dependents,
  showDepForm,
  setShowDepForm,
  depForm,
  setDepForm,
  addDependent,
  deleteDependent,
  SectionTitle,
}) {
  return (
    <>
      {/* ════════════════════════════════════════
          歷程 / 流程 & 任務
      ════════════════════════════════════════ */}
      {subTab === 'workflows' && (
        <>
          {onboardingTasks.length > 0 && (() => {
            const completed = onboardingTasks.filter(t => t.status === '已完成').length
            const total = onboardingTasks.length
            const pct = total > 0 ? Math.round(completed / total * 100) : 0
            return (
              <>
                <SectionTitle icon="📝" text={`到職 / 工作流程任務 (${completed}/${total})`} />
                <div style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                    <span>完成進度</span><span>{pct}%</span>
                  </div>
                  <div style={{ height: 6, borderRadius: 3, background: 'var(--glass-light)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: 3, background: pct === 100 ? 'var(--accent-green)' : 'var(--accent-cyan)', width: `${pct}%`, transition: 'width 0.3s' }} />
                  </div>
                </div>
                {onboardingTasks.map(t => (
                  <div key={t.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--bg-card)', borderRadius: 8, marginBottom: 4, border: '1px solid var(--border-subtle)', fontSize: 13 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 16 }}>{t.status === '已完成' ? '✅' : t.status === '進行中' ? '🔄' : '⬜'}</span>
                      <div>
                        <div style={{ fontWeight: 600 }}>{t.title}</div>
                        {t.workflow_instances?.template_name && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t.workflow_instances.template_name}</div>}
                      </div>
                    </div>
                    <span className={`badge ${t.status === '已完成' ? 'badge-success' : t.status === '進行中' ? 'badge-warning' : 'badge-cyan'}`} style={{ fontSize: 11 }}>{t.status}</span>
                  </div>
                ))}
              </>
            )
          })()}

          <SectionTitle icon="🚀" text={`進行中 / 已完成流程 (${targetWorkflows.length})`} />
          {targetWorkflows.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32, fontSize: 13 }}>
              尚無以此員工為對象的流程<br />
              <span style={{ fontSize: 11 }}>（部署 SOP 時若選擇此員工為對象，會在這裡顯示）</span>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {targetWorkflows.map(wf => {
                const wfTasks = targetWfTasks.filter(t => t.workflow_instance_id === wf.id)
                const done = wfTasks.filter(t => t.status === '已完成').length
                const total = wfTasks.length || 1
                const pct = Math.round((done / total) * 100)
                const wfColor = wf.status === '進行中' ? 'var(--accent-cyan)' : wf.status === '已完成' ? 'var(--accent-green)' : 'var(--accent-orange)'
                return (
                  <div key={wf.id} style={{ padding: 14, borderRadius: 10, background: 'var(--glass-light)', border: '1px solid var(--border-subtle)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>
                        {wf.template_name}
                        {wf.priority && <span style={{ marginLeft: 6, fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>優先：{wf.priority}</span>}
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 700, color: wfColor }}>{wf.status}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <div style={{ flex: 1, height: 6, background: 'rgba(148,163,184,0.1)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: wfColor }} />
                      </div>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', minWidth: 60, textAlign: 'right' }}>{done} / {total} ({pct}%)</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                      {wf.store && <span>📍 {wf.store}</span>}
                      {wf.planned_start_date && <span>🗓 {wf.planned_start_date}{wf.planned_end_date ? ` ~ ${wf.planned_end_date}` : ''}</span>}
                      {wf.started_by && <span>👤 由 {wf.started_by} 發起</span>}
                    </div>
                    {wf.notes && <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 6, fontStyle: 'italic' }}>📝 {wf.notes}</div>}
                    {wfTasks.length > 0 && (
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--border-subtle)' }}>
                        {wfTasks.slice(0, 5).map(t => (
                          <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '3px 0' }}>
                            <span>
                              {t.status === '已完成' ? '✅' : t.status === '進行中' ? '⏳' : '⚪'}
                              <span style={{ marginLeft: 6, color: t.status === '已完成' ? 'var(--text-muted)' : 'var(--text-primary)', textDecoration: t.status === '已完成' ? 'line-through' : 'none' }}>{t.title}</span>
                            </span>
                            <span style={{ color: 'var(--text-muted)' }}>{t.assignee || '—'}</span>
                          </div>
                        ))}
                        {wfTasks.length > 5 && <div style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center', marginTop: 4 }}>...另有 {wfTasks.length - 5} 個步驟</div>}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* ════════════════════════════════════════
          歷程 / 指派 & 異動
      ════════════════════════════════════════ */}
      {subTab === 'assignments' && (
        <>
          <SectionTitle icon="📋" text={`指派歷史 (${assignments.length})`} />
          {assignments.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20, fontSize: 13 }}>尚無指派紀錄</div>
          ) : (
            <div className="data-table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>主/次</th><th>部門</th><th>門市</th><th>職稱</th><th>職等</th>
                    <th>類型</th><th>部分工時</th><th>週時數</th><th>起始</th><th>結束</th><th>生效</th><th>修改人</th>
                  </tr>
                </thead>
                <tbody>
                  {assignments.map(a => (
                    <tr key={a.id} style={{ opacity: a.is_active ? 1 : 0.7 }}>
                      <td><span className={`badge ${a.department_type === '主要' ? 'badge-cyan' : 'badge-neutral'}`} style={{ fontSize: 10 }}>{a.department_type}</span></td>
                      <td style={{ fontSize: 12 }}>{a.departments?.name || '—'}</td>
                      <td style={{ fontSize: 12 }}>{a.stores?.name || '—'}</td>
                      <td style={{ fontSize: 12 }}>{a.position || '—'}</td>
                      <td style={{ fontSize: 12 }}>{a.job_grade || '—'}</td>
                      <td style={{ fontSize: 12 }}>{a.employment_type || '—'}</td>
                      <td style={{ fontSize: 12 }}>{a.is_part_time ? '是' : '否'}</td>
                      <td style={{ fontSize: 12 }}>{a.avg_weekly_hours || 0}</td>
                      <td style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{a.start_date}</td>
                      <td style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{a.end_date || '—'}</td>
                      <td><span className={`badge ${a.is_active ? 'badge-success' : 'badge-neutral'}`} style={{ fontSize: 10 }}>{a.is_active ? '是' : '否'}</span></td>
                      <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{a.updated_by_emp?.name || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <SectionTitle icon="📦" text={`異動紀錄 (${transfers.length})`} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
            <button className="btn btn-sm btn-secondary" onClick={addTransfer}><Plus size={13} /></button>
          </div>
          {transfers.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20, fontSize: 13 }}>尚無異動紀錄</div>
          ) : transfers.map(t => (
            <div key={t.id} style={{ padding: '10px 14px', background: 'var(--bg-card)', borderRadius: 8, marginBottom: 6, border: '1px solid var(--border-subtle)', fontSize: 13 }}>
              <div style={{ fontWeight: 600 }}>{t.transfer_date}</div>
              <div style={{ color: 'var(--text-muted)', marginTop: 2 }}>{t.from_store || '—'} → {t.to_store || '—'}{t.reason && <span> · {t.reason}</span>}</div>
            </div>
          ))}
        </>
      )}

      {/* ════════════════════════════════════════
          歷程 / 評估 & 眷屬
      ════════════════════════════════════════ */}
      {subTab === 'reviews' && (
        <>
          <SectionTitle icon="🎯" text="績效評估" />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
            <button className="btn btn-sm btn-secondary" onClick={addReview}><Plus size={13} /></button>
          </div>
          {reviews.length === 0
            ? <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20, fontSize: 13 }}>尚無紀錄</div>
            : reviews.map(r => (
              <div key={r.id} style={{ padding: '10px 14px', background: 'var(--bg-card)', borderRadius: 8, marginBottom: 6, border: '1px solid var(--border-subtle)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span style={{ fontWeight: 600 }}>{r.review_date} · {r.reviewer}</span>
                  <span style={{ color: 'var(--accent-orange)', fontWeight: 700 }}>{'⭐'.repeat(r.score || 0)}</span>
                </div>
                {r.notes && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{r.notes}</div>}
              </div>
            ))
          }

          <SectionTitle icon="👥" text={`眷屬 (${dependents.length})`} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
            <button className="btn btn-sm btn-secondary" onClick={() => setShowDepForm(!showDepForm)}><Plus size={13} /></button>
          </div>
          {showDepForm && (
            <div style={{ padding: 14, background: 'var(--bg-card)', borderRadius: 10, border: '1px solid var(--accent-cyan)', marginBottom: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>姓名 *</div>
                  <input className="form-input" style={{ width: '100%', fontSize: 12 }} placeholder="眷屬姓名" value={depForm.name} onChange={e => setDepForm(f => ({ ...f, name: e.target.value }))} />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>關係</div>
                  <select className="form-input" style={{ width: '100%', fontSize: 12 }} value={depForm.relationship} onChange={e => setDepForm(f => ({ ...f, relationship: e.target.value }))}>
                    <option>配偶</option><option>子女</option><option>父</option><option>母</option><option>其他</option>
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>身分證字號</div>
                  <input className="form-input" style={{ width: '100%', fontSize: 12 }} placeholder="選填" value={depForm.id_number} onChange={e => setDepForm(f => ({ ...f, id_number: e.target.value }))} />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>出生日期</div>
                  <input className="form-input" type="date" style={{ width: '100%', fontSize: 12 }} value={depForm.birth_date} onChange={e => setDepForm(f => ({ ...f, birth_date: e.target.value }))} />
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                  <input type="checkbox" checked={depForm.health_ins} onChange={e => setDepForm(f => ({ ...f, health_ins: e.target.checked }))} />
                  加保健保（眷屬附加）
                </label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-sm btn-secondary" onClick={() => setShowDepForm(false)} style={{ fontSize: 11 }}>取消</button>
                  <button className="btn btn-sm btn-primary" onClick={addDependent} style={{ fontSize: 11 }}>新增</button>
                </div>
              </div>
            </div>
          )}
          {dependents.length === 0 && !showDepForm
            ? <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20, fontSize: 13 }}>尚無眷屬</div>
            : dependents.map(d => (
              <div key={d.id} style={{ padding: '10px 14px', background: 'var(--bg-card)', borderRadius: 8, marginBottom: 4, border: '1px solid var(--border-subtle)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{d.name}</span>
                    <span className="badge badge-cyan" style={{ fontSize: 11 }}>{d.relationship || '—'}</span>
                    {d.health_ins && <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: 'var(--accent-green-dim)', color: 'var(--accent-green)', fontWeight: 600 }}>健保</span>}
                  </div>
                  <button onClick={() => deleteDependent(d.id)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', opacity: 0.5 }}><Trash2 size={13} /></button>
                </div>
                {(d.id_number || d.birth_date) && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    {d.id_number && <span>ID: {d.id_number.slice(0, 3)}***</span>}
                    {d.id_number && d.birth_date && <span> · </span>}
                    {d.birth_date && <span>生日: {d.birth_date}</span>}
                  </div>
                )}
              </div>
            ))
          }
        </>
      )}

      {/* ════════════════════════════════════════
          歷程 / 變更日誌 (admin)
      ════════════════════════════════════════ */}
      {subTab === 'changelog' && isAdmin && (
        <ChangelogPanel tables={['employees']} targetId={employee?.id} orgId={employee?.organization_id} />
      )}
    </>
  )
}
