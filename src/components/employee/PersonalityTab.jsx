import { useState, useEffect } from 'react'
import { Save, Edit2 } from 'lucide-react'
import { getEmployeePersonality, upsertEmployeePersonality } from '../../lib/db'
import mbtiData from '../../lib/personality/mbtiProfiles.json'
import astroData from '../../lib/personality/astrologyDefinitions.json'

const MBTI_TYPES = Object.keys(mbtiData.types)
const SIGNS = astroData.meta.signs
const PLANETS = ['sun', 'venus', 'mars', 'mercury', 'saturn']

export default function PersonalityTab({ employee }) {
  const [profile, setProfile] = useState(null)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ mbti_type: '', astrology: {}, notes: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!employee?.id) return
    getEmployeePersonality(employee.id).then(({ data }) => {
      if (data) {
        setProfile(data)
        setForm({ mbti_type: data.mbti_type || '', astrology: data.astrology || {}, notes: data.notes || '' })
      }
    })
  }, [employee?.id])

  const handleSave = async () => {
    setSaving(true)
    const { data, error } = await upsertEmployeePersonality({
      employee_id: employee.id,
      mbti_type: form.mbti_type || null,
      astrology: form.astrology,
      notes: form.notes || null,
      assessed_by: '系統',
      assessed_at: new Date().toISOString().slice(0, 10),
    })
    if (error) alert('儲存失敗：' + error.message)
    else { setProfile(data); setEditing(false) }
    setSaving(false)
  }

  const setAstro = (planet, sign) => setForm(f => ({ ...f, astrology: { ...f.astrology, [planet]: sign } }))
  const mbti = form.mbti_type ? mbtiData.types[form.mbti_type] : null

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>🧬 性格分析</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {editing ? (
            <button className="btn btn-primary" style={{ fontSize: 12, padding: '4px 12px' }} onClick={handleSave} disabled={saving}>
              <Save size={12} /> {saving ? '儲存中...' : '儲存'}
            </button>
          ) : (
            <button className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 12px' }} onClick={() => setEditing(true)}>
              <Edit2 size={12} /> 編輯
            </button>
          )}
        </div>
      </div>

      {/* ── MBTI Section ── */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
          🧠 MBTI 人格類型
        </div>

        {editing ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {MBTI_TYPES.map(type => {
              const t = mbtiData.types[type]
              return (
                <button key={type} onClick={() => setForm(f => ({ ...f, mbti_type: type }))}
                  style={{
                    padding: '6px 12px', borderRadius: 8, border: '2px solid',
                    borderColor: form.mbti_type === type ? 'var(--accent-cyan)' : 'var(--border-subtle)',
                    background: form.mbti_type === type ? 'rgba(6,182,212,0.1)' : 'var(--bg-card)',
                    cursor: 'pointer', fontSize: 12, fontWeight: 600,
                    color: form.mbti_type === type ? 'var(--accent-cyan)' : 'var(--text-secondary)',
                  }}>
                  {t.emoji} {type}
                </button>
              )
            })}
          </div>
        ) : form.mbti_type ? (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 14px', background: 'rgba(6,182,212,0.1)', borderRadius: 10, border: '1px solid rgba(6,182,212,0.3)', marginBottom: 12 }}>
            <span style={{ fontSize: 20 }}>{mbti?.emoji}</span>
            <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--accent-cyan)' }}>{form.mbti_type}</span>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{mbti?.name} · {mbti?.name_en}</span>
          </div>
        ) : (
          <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>尚未設定 MBTI，請點擊「編輯」</div>
        )}

        {/* MBTI Profile Detail */}
        {mbti && (
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 10, padding: 16 }}>
            <div style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 12 }}>{mbti.summary}</div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-green)', marginBottom: 6 }}>優勢</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {mbti.strengths.map((s, i) => (
                    <span key={i} style={{ padding: '2px 8px', borderRadius: 10, background: 'rgba(16,185,129,0.1)', fontSize: 11, color: 'var(--accent-green)' }}>{s}</span>
                  ))}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-orange)', marginBottom: 6 }}>注意</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {mbti.weaknesses.map((w, i) => (
                    <span key={i} style={{ padding: '2px 8px', borderRadius: 10, background: 'rgba(245,158,11,0.1)', fontSize: 11, color: 'var(--accent-orange)' }}>{w}</span>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px', fontSize: 12 }}>
              <div><span style={{ color: 'var(--text-muted)' }}>工作風格：</span>{mbti.work_style}</div>
              <div><span style={{ color: 'var(--text-muted)' }}>溝通方式：</span>{mbti.communication}</div>
              <div><span style={{ color: 'var(--text-muted)' }}>領導風格：</span>{mbti.leadership}</div>
              <div><span style={{ color: 'var(--text-muted)' }}>團隊角色：</span>{mbti.team_role}</div>
            </div>

            <div style={{ marginTop: 10, fontSize: 12 }}>
              <span style={{ color: 'var(--text-muted)' }}>適合角色：</span>
              {mbti.ideal_roles.map((r, i) => (
                <span key={i} style={{ padding: '2px 8px', marginLeft: 4, borderRadius: 10, background: 'rgba(6,182,212,0.1)', fontSize: 11, color: 'var(--accent-cyan)' }}>{r}</span>
              ))}
            </div>

            <div style={{ marginTop: 10, fontSize: 12 }}>
              <span style={{ color: 'var(--text-muted)' }}>成長建議：</span>
              <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                {mbti.growth_areas.map((g, i) => <li key={i} style={{ marginBottom: 2 }}>{g}</li>)}
              </ul>
            </div>

            <div style={{ marginTop: 10, fontSize: 12 }}>
              <span style={{ color: 'var(--text-muted)' }}>搭配最佳：</span>
              {mbti.compatibility.best.map((c, i) => (
                <span key={i} style={{ padding: '2px 8px', marginLeft: 4, borderRadius: 10, background: 'rgba(16,185,129,0.1)', fontSize: 11, fontWeight: 600, color: 'var(--accent-green)' }}>{mbtiData.types[c]?.emoji} {c}</span>
              ))}
              <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>挑戰：</span>
              {mbti.compatibility.challenging.map((c, i) => (
                <span key={i} style={{ padding: '2px 8px', marginLeft: 4, borderRadius: 10, background: 'rgba(245,158,11,0.1)', fontSize: 11, color: 'var(--accent-orange)' }}>{mbtiData.types[c]?.emoji} {c}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Astrology Section ── */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
          ✨ 占星行星配置
        </div>

        {PLANETS.map(planetKey => {
          const planet = astroData.planets[planetKey]
          const selectedSign = form.astrology?.[planetKey]
          const signDef = selectedSign ? planet.signs[selectedSign] : null

          return (
            <div key={planetKey} style={{ marginBottom: 12, padding: 12, background: 'var(--bg-card)', borderRadius: 10, border: '1px solid var(--border-subtle)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 18 }}>{planet.symbol}</span>
                <div>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>{planet.name}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 6 }}>{planet.domain}</span>
                </div>
                {selectedSign && !editing && (
                  <span style={{ marginLeft: 'auto', padding: '3px 10px', borderRadius: 10, background: 'rgba(139,92,246,0.1)', fontSize: 12, fontWeight: 600, color: 'var(--accent-purple)' }}>
                    {signDef?.emoji} {selectedSign}
                  </span>
                )}
              </div>

              {editing ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {SIGNS.map((sign, idx) => (
                    <button key={sign} onClick={() => setAstro(planetKey, sign)} style={{
                      padding: '3px 8px', borderRadius: 6, border: '1px solid',
                      borderColor: selectedSign === sign ? 'var(--accent-purple)' : 'var(--border-subtle)',
                      background: selectedSign === sign ? 'rgba(139,92,246,0.1)' : 'transparent',
                      cursor: 'pointer', fontSize: 11,
                      color: selectedSign === sign ? 'var(--accent-purple)' : 'var(--text-muted)',
                    }}>
                      {astroData.meta.signs_symbol[idx]} {sign}
                    </button>
                  ))}
                </div>
              ) : signDef ? (
                <div style={{ fontSize: 12 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>{signDef.trait}</div>
                  <div style={{ color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 4 }}>{signDef.description}</div>
                  <div style={{ color: 'var(--accent-cyan)', fontSize: 11 }}>💼 {signDef.work_impact}</div>
                </div>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>未設定</div>
              )}
            </div>
          )
        })}
      </div>

      {/* ── Notes ── */}
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>📝 備註</div>
        {editing ? (
          <textarea className="form-input" style={{ width: '100%', minHeight: 60, fontSize: 13 }}
            value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            placeholder="性格觀察、團隊搭配建議..." />
        ) : (
          <div style={{ fontSize: 13, color: form.notes ? 'var(--text-primary)' : 'var(--text-muted)', padding: '8px 12px', background: 'var(--bg-card)', borderRadius: 8, minHeight: 40 }}>
            {form.notes || '無備註'}
          </div>
        )}
        {profile?.assessed_at && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>最後更新：{profile.assessed_at}</div>
        )}
      </div>
    </div>
  )
}
