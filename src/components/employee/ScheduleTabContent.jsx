import { Plus, Trash2 } from 'lucide-react'

const DAYS = ['一', '二', '三', '四', '五', '六', '日']
const AVAIL_STATUS = ['可排班', '偏好', '偏不排', '不可']
const AVAIL_COLORS = { '可排班': 'var(--accent-green)', '偏好': 'var(--accent-blue)', '偏不排': 'var(--accent-orange)', '不可': 'var(--accent-red)' }

export default function ScheduleTabContent({
  form,
  set,
  subTab,
  skills,
  newSkill,
  setNewSkill,
  newSkillLevel,
  setNewSkillLevel,
  addSkill,
  deleteSkill,
  availability,
  setAvail,
  setAvailShift,
  schedPrefs,
  addSchedPref,
  deleteSchedPref,
  leaveRecords,
  SectionTitle,
  L,
}) {
  return (
    <>
      {/* ════════════════════════════════════════
          排班 / 技能 & 權限
      ════════════════════════════════════════ */}
      {subTab === 'skills' && (
        <>
          <SectionTitle icon="🏷️" text="技能" />
          {skills.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 12 }}>尚未新增技能</div>}
          {skills.map(s => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--bg-card)', borderRadius: 8, marginBottom: 4, border: '1px solid var(--border-subtle)' }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{s.skill_name}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="badge badge-cyan" style={{ fontSize: 11 }}>{s.level}</span>
                <button onClick={() => deleteSkill(s.id)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', opacity: 0.5 }}><Trash2 size={13} /></button>
              </div>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <input className="form-input" style={{ flex: 1, fontSize: 13 }} placeholder="新增技能 (例如: 拉花、咖啡師)" value={newSkill} onChange={e => setNewSkill(e.target.value)} onKeyDown={e => e.key === 'Enter' && addSkill()} />
            <select className="form-input" style={{ fontSize: 13, width: 80 }} value={newSkillLevel} onChange={e => setNewSkillLevel(e.target.value)}>
              <option>基礎</option><option>中級</option><option>進階</option><option>專家</option>
            </select>
            <button className="btn btn-sm btn-primary" onClick={addSkill}><Plus size={13} /></button>
          </div>

          <SectionTitle icon="🔑" text="開 / 關店" />
          <div style={{ display: 'flex', gap: 16 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.can_open || false} onChange={e => set('can_open', e.target.checked)} /> 可開店
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.can_close || false} onChange={e => set('can_close', e.target.checked)} /> 可關店
            </label>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>AI 排班會優先安排有開/關店能力的員工於營業起始或結束時段</div>

          <SectionTitle icon="⭐" text="排班優先級" />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {[
              { value: 1, label: '最優先', color: 'var(--accent-red)',    desc: '王牌員工，優先排熱門時段' },
              { value: 2, label: '優先',   color: 'var(--accent-orange)', desc: '表現優秀' },
              { value: 3, label: '一般',   color: 'var(--accent-cyan)',   desc: '預設' },
              { value: 4, label: '低',     color: 'var(--text-tertiary)', desc: '新進/訓練中' },
              { value: 5, label: '最低',   color: 'var(--text-muted)',    desc: '備用人力' },
            ].map(p => (
              <button key={p.value} onClick={() => set('schedule_priority', p.value)} title={p.desc} style={{
                flex: 1, padding: '8px 4px', borderRadius: 8, border: 'none', cursor: 'pointer',
                background: (form.schedule_priority || 3) === p.value ? p.color : 'var(--bg-card)',
                color: (form.schedule_priority || 3) === p.value ? '#fff' : 'var(--text-muted)',
                fontSize: 12, fontWeight: 700,
                outline: (form.schedule_priority || 3) === p.value ? `2px solid ${p.color}` : '1px solid var(--border-subtle)',
              }}>{p.label}</button>
            ))}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>AI 排班會根據優先級決定排班順序，優先級高的員工會先被排入尖峰時段</div>
        </>
      )}

      {/* ════════════════════════════════════════
          排班 / 班表設定
      ════════════════════════════════════════ */}
      {subTab === 'availability' && (
        <>
          <SectionTitle icon="📅" text="每週可排班時間" />
          <div style={{ background: 'var(--bg-card)', borderRadius: 10, border: '1px solid var(--border-subtle)', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: 'var(--glass-light)' }}>
                  <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 700 }}>星期</th>
                  <th style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 700 }}>狀態</th>
                  <th style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 700 }}>偏好班別</th>
                </tr>
              </thead>
              <tbody>
                {DAYS.map((day, idx) => {
                  const av = availability.find(a => a.day_of_week === idx)
                  const status = av?.status || '可排班'
                  return (
                    <tr key={idx} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: '6px 12px', fontWeight: 600 }}>週{day}</td>
                      <td style={{ padding: '6px 12px', textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                          {AVAIL_STATUS.map(s => (
                            <button key={s} onClick={() => setAvail(idx, s)} style={{
                              padding: '3px 8px', borderRadius: 4, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600,
                              background: status === s ? AVAIL_COLORS[s] + '22' : 'transparent',
                              color: status === s ? AVAIL_COLORS[s] : 'var(--text-muted)',
                              outline: status === s ? `1.5px solid ${AVAIL_COLORS[s]}` : '1px solid var(--border-subtle)',
                            }}>{s}</button>
                          ))}
                        </div>
                      </td>
                      <td style={{ padding: '6px 12px', textAlign: 'center' }}>
                        <select className="form-input" style={{ fontSize: 11, padding: '2px 6px', width: 'auto', minWidth: 80 }}
                          value={av?.preferred_shift || ''} onChange={e => setAvailShift(idx, e.target.value)}>
                          <option value="">—</option>
                          <option value="早班">早班</option><option value="午班">午班</option>
                          <option value="晚班">晚班</option><option value="全天">全天</option>
                        </select>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>AI 排班會參考此設定，避免在「不可」的時段安排班表</div>

          <SectionTitle icon="📋" text="排班偏好" />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
            <button className="btn btn-sm btn-secondary" onClick={addSchedPref}><Plus size={13} /></button>
          </div>
          {schedPrefs.length === 0
            ? <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20, fontSize: 13 }}>尚無排班偏好</div>
            : schedPrefs.map(p => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--bg-card)', borderRadius: 8, marginBottom: 4, border: '1px solid var(--border-subtle)', fontSize: 13 }}>
                <span>{p.notes || p.pref_type}</span>
                <button onClick={() => deleteSchedPref(p.id)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', opacity: 0.5 }}><Trash2 size={13} /></button>
              </div>
            ))
          }

          <SectionTitle icon="🏖️" text="請假紀錄" />
          {leaveRecords.length === 0
            ? <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20, fontSize: 13 }}>尚無請假紀錄</div>
            : leaveRecords.map(lv => (
              <div key={lv.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--bg-card)', borderRadius: 8, marginBottom: 4, border: '1px solid var(--border-subtle)', fontSize: 13 }}>
                <span>{lv.type} · {lv.start_date} · {lv.days}天</span>
                <span className={`badge ${lv.status === '已核准' ? 'badge-success' : lv.status === '已駁回' ? 'badge-danger' : 'badge-warning'}`} style={{ fontSize: 11 }}>{lv.status}</span>
              </div>
            ))
          }
        </>
      )}
    </>
  )
}
