import { Plus, Trash2, Upload, Eye } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import EmployeeChildTableEditor from '../../pages/org/components/EmployeeChildTableEditor'
import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'

// LINE brand green — not a CSS token, defined by LINE's brand guidelines
const LINE_BRAND_GREEN = '#06C755'

const SPECIAL_CATEGORIES = ['身心障礙者', '中低收入戶', '原住民', '中高齡者 (45+)', '長期失業者', '更生人', '獨力負擔家計者', '家庭暴力被害人', '二度就業婦女']

const maskId = (v) => v ? v.slice(0, 3) + '****' + v.slice(-2) : ''

export default function ProfileTabContent({
  form,
  set,
  isAdmin,
  subTab,
  employee,
  passbookUploading,
  handlePassbookUpload,
  lineAccounts,
  setLineAccounts,
  lineChannels,
  newLineChannel,
  setNewLineChannel,
  newLineUserId,
  setNewLineUserId,
  unboundLineUsers,
  setUnboundLineUsers,
  manualLineInput,
  setManualLineInput,
  Toggle,
  SectionTitle,
  L,
}) {
  const toggleSpecial = (cat) => {
    const current = form.special_categories || []
    set('special_categories', current.includes(cat) ? current.filter(c => c !== cat) : [...current, cat])
  }

  return (
    <>
      {/* ════════════════════════════════════════
          員工資料 / 基本資料
      ════════════════════════════════════════ */}
      {subTab === 'basic' && (
        <>
          <SectionTitle icon="👤" text="姓名" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div><div style={L}>姓</div><input className="form-input" style={{ width: '100%' }} value={form.last_name || ''} onChange={e => set('last_name', e.target.value)} /></div>
            <div><div style={L}>名</div><input className="form-input" style={{ width: '100%' }} value={form.first_name || ''} onChange={e => set('first_name', e.target.value)} /></div>
          </div>
          <div><div style={L}>英文名</div><input className="form-input" style={{ width: '50%' }} value={form.name_en || ''} onChange={e => set('name_en', e.target.value)} /></div>

          <SectionTitle icon="📋" text="個人資料" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div><div style={L}>出生日期</div><input className="form-input" type="date" style={{ width: '100%' }} value={form.birth_date || ''} onChange={e => set('birth_date', e.target.value)} /></div>
            <div><div style={L}>性別</div>
              <select className="form-input" style={{ width: '100%' }} value={form.gender || ''} onChange={e => set('gender', e.target.value)}>
                <option value="">— 請選擇 —</option><option>男</option><option>女</option><option>其他</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div><div style={L}>國籍</div><input className="form-input" style={{ width: '100%' }} value={form.nationality || 'TW'} onChange={e => set('nationality', e.target.value)} /></div>
            <div><div style={L}>身分證字號</div><input className="form-input" style={{ width: '100%' }} value={isAdmin ? (form.id_number || '') : maskId(form.id_number)} onChange={e => set('id_number', e.target.value)} readOnly={!isAdmin} /></div>
          </div>
          <div><div style={L}>地址</div><input className="form-input" style={{ width: '100%' }} value={form.address || ''} onChange={e => set('address', e.target.value)} /></div>

          <SectionTitle icon="🏷️" text="特殊身分類別" />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {SPECIAL_CATEGORIES.map(cat => (
              <label key={cat} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={(form.special_categories || []).includes(cat)} onChange={() => toggleSpecial(cat)} />
                {cat}
              </label>
            ))}
          </div>
        </>
      )}

      {/* ════════════════════════════════════════
          員工資料 / 聯絡方式
      ════════════════════════════════════════ */}
      {subTab === 'contact' && (
        <>
          <SectionTitle icon="📱" text="聯絡方式" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div><div style={L}>工作電話</div><input className="form-input" style={{ width: '100%' }} value={form.phone || ''} onChange={e => set('phone', e.target.value)} /></div>
          </div>

          <SectionTitle icon="🚨" text="緊急聯絡人" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
            <div><div style={L}>姓名</div><input className="form-input" style={{ width: '100%' }} value={form.emergency_name || ''} onChange={e => set('emergency_name', e.target.value)} /></div>
            <div><div style={L}>電話</div><input className="form-input" style={{ width: '100%' }} value={form.emergency_phone || ''} onChange={e => set('emergency_phone', e.target.value)} /></div>
            <div>
              <div style={L}>關係</div>
              <select className="form-input" style={{ width: '100%' }}
                value={form.emergency_contact_relation || ''}
                onChange={e => set('emergency_contact_relation', e.target.value)}>
                <option value="">請選擇</option>
                <option value="父母">父母</option>
                <option value="配偶">配偶</option>
                <option value="子女">子女</option>
                <option value="兄弟姊妹">兄弟姊妹</option>
                <option value="祖父母">祖父母</option>
                <option value="親戚">親戚</option>
                <option value="朋友">朋友</option>
                <option value="其他">其他</option>
              </select>
            </div>
          </div>

          <SectionTitle icon="💬" text="LINE 帳號綁定" />
          {lineAccounts.length === 0 ? (
            <div style={{ padding: '12px 14px', background: 'var(--bg-card)', borderRadius: 8, border: '1px solid var(--border-subtle)', fontSize: 12, color: 'var(--text-muted)' }}>
              尚未綁定任何 LINE 帳號
            </div>
          ) : lineAccounts.map(la => (
            <div key={la.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--bg-card)', borderRadius: 8, border: '1px solid var(--border-subtle)', marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {la.picture_url
                  ? <img src={la.picture_url} alt="" style={{ width: 32, height: 32, borderRadius: '50%' }} />
                  : <div style={{ width: 32, height: 32, borderRadius: '50%', background: LINE_BRAND_GREEN, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 14, fontWeight: 700 }}>L</div>
                }
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{la.display_name || 'LINE 使用者'}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{la.line_user_id?.slice(0, 12)}...</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: la.is_primary ? 'var(--accent-green-dim)' : 'var(--glass-light)', color: la.is_primary ? 'var(--accent-green)' : 'var(--text-muted)', fontWeight: 600 }}>
                  {la.line_channels?.name || la.channel_id}{la.is_primary ? ' · 主要' : ''}
                </span>
                <button onClick={async () => {
                  if (!(await confirm({ message: '確定解除此 LINE 綁定？' }))) return
                  await supabase.from('employee_line_accounts').delete().eq('id', la.id)
                  setLineAccounts(prev => prev.filter(x => x.id !== la.id))
                }} style={{ background: 'none', border: 'none', color: 'var(--accent-red)', cursor: 'pointer', padding: 2 }}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'flex-start' }}>
            <select className="form-input" style={{ flex: '0 0 140px', fontSize: 12 }} value={newLineChannel} onChange={e => setNewLineChannel(e.target.value)}>
              <option value="">選擇頻道</option>
              {lineChannels.map(ch => <option key={ch.id} value={String(ch.id)}>{ch.name}</option>)}
            </select>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {!manualLineInput && unboundLineUsers.length > 0 ? (
                <select className="form-input" style={{ fontSize: 12 }} value={newLineUserId} onChange={e => setNewLineUserId(e.target.value)}>
                  <option value="">從系統選擇 LINE 使用者…</option>
                  {unboundLineUsers.map(u => <option key={u.line_user_id} value={u.line_user_id}>{u.display_name || u.line_user_id.slice(0, 14) + '…'}</option>)}
                </select>
              ) : (
                <input className="form-input" type="text" style={{ fontSize: 12 }} placeholder="LINE User ID（U 開頭）" value={newLineUserId} onChange={e => setNewLineUserId(e.target.value)} />
              )}
              {newLineChannel && unboundLineUsers.length > 0 && (
                <button type="button" onClick={() => { setManualLineInput(m => !m); setNewLineUserId('') }}
                  style={{ background: 'none', border: 'none', color: 'var(--accent-cyan)', cursor: 'pointer', fontSize: 10, textAlign: 'left', padding: 0 }}>
                  {manualLineInput ? '← 從系統已知名單選擇' : '✏️ 手動輸入 LINE ID'}
                </button>
              )}
            </div>
            <button className="btn btn-primary" style={{ fontSize: 12, padding: '6px 14px', whiteSpace: 'nowrap' }}
              disabled={!newLineUserId || !newLineChannel}
              onClick={async () => {
                const uid = newLineUserId.trim()
                if (!uid.startsWith('U') || uid.length < 20) { toast.error('LINE User ID 格式錯誤（應以 U 開頭且至少 20 字元）'); return }
                const chId = parseInt(newLineChannel)
                const { data, error } = await supabase.from('employee_line_accounts').insert({
                  employee_id: employee.id, channel_id: chId, line_user_id: uid,
                  is_primary: lineAccounts.length === 0, is_verified: true,
                }).select('*, line_channels(id, code, name)').single()
                if (error) { toast.error('儲存失敗，請稍後再試'); return }
                await supabase.from('line_users').update({ employee_id: employee.id, is_verified: true })
                  .eq('channel_id', chId).eq('line_user_id', uid).catch(() => {})
                setLineAccounts(prev => [...prev, data])
                setUnboundLineUsers(prev => prev.filter(u => u.line_user_id !== uid))
                setNewLineUserId('')
              }}>
              <Plus size={12} /> 綁定
            </button>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
            員工也可在 LINE 輸入 <code style={{ background: 'var(--glass-light)', padding: '1px 6px', borderRadius: 3 }}>/註冊 {employee.name}</code> 自助綁定
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'var(--bg-card)', borderRadius: 8, marginTop: 10, border: '1px solid var(--border-subtle)' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>LINE 管理員權限</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>開啟後可在 LINE 使用管理指令</div>
            </div>
            <Toggle checked={form.line_admin || false} onChange={e => set('line_admin', e.target.checked)} />
          </div>
        </>
      )}

      {/* ════════════════════════════════════════
          員工資料 / 背景資歷 (admin)
      ════════════════════════════════════════ */}
      {subTab === 'background' && isAdmin && (
        <>
          <SectionTitle icon="🎓" text="學歷紀錄" />
          <EmployeeChildTableEditor employeeId={employee.id} table="education_records" />
          <SectionTitle icon="💼" text="工作經歷" />
          <EmployeeChildTableEditor employeeId={employee.id} table="work_experiences" />
          <SectionTitle icon="👪" text="家庭成員" />
          <EmployeeChildTableEditor employeeId={employee.id} table="family_members" />
          <SectionTitle icon="📜" text="證照清單" />
          <EmployeeChildTableEditor employeeId={employee.id} table="certifications" />
        </>
      )}
    </>
  )
}
