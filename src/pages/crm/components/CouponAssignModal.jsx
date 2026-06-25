import { useState, useEffect } from 'react'
import { Search } from 'lucide-react'
import { getMembers, assignCoupon } from '../../../lib/db'

export default function CouponAssignModal({ coupon, orgId, onClose, onAssigned }) {
  const [members,  setMembers]  = useState([])
  const [search,   setSearch]   = useState('')
  const [selected, setSelected] = useState(new Set())
  const [saving,   setSaving]   = useState(false)
  const [err,      setErr]      = useState('')
  const [done,     setDone]     = useState(false)

  useEffect(() => {
    getMembers(orgId).then(({ data }) => setMembers(data ?? []))
  }, [orgId])

  const filtered = members.filter(m => {
    const q = search.toLowerCase()
    return !q || m.name?.toLowerCase().includes(q) || m.phone?.includes(q) || m.member_number?.toLowerCase().includes(q)
  })

  function toggle(id) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function submit() {
    if (selected.size === 0) { setErr('請先選取會員'); return }
    setSaving(true); setErr('')
    const results = await Promise.allSettled(
      [...selected].map(mid => assignCoupon(coupon.id, mid, orgId, 'individual'))
    )
    const failed = results.filter(r => r.status === 'rejected' || r.value?.error).length
    if (failed > 0 && failed === selected.size) {
      setErr('發放失敗（可能已發放過此券給所選會員）')
      setSaving(false)
      return
    }
    setDone(true)
    setSaving(false)
    setTimeout(onAssigned, 900)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
      <div style={{ background: 'var(--bg-primary)', borderRadius: 14, padding: 24, width: 460, maxWidth: '94vw', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
        <h2 style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>發放優惠券</h2>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
          <code style={{ background: 'var(--bg-tertiary)', padding: '2px 6px', borderRadius: 4 }}>{coupon.code}</code>
          <span style={{ marginLeft: 8 }}>{coupon.name}</span>
        </div>

        {done ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 40 }}>
            <div style={{ fontSize: 40 }}>✓</div>
            <div style={{ color: 'var(--accent-green)', fontWeight: 600, fontSize: 16 }}>已成功發放給 {selected.size} 位會員</div>
          </div>
        ) : (
          <>
            <div style={{ position: 'relative', marginBottom: 12 }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="搜尋姓名、電話、會員編號…"
                style={{ width: '100%', padding: '8px 10px 8px 30px', borderRadius: 8, border: '1px solid var(--border-primary)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
              />
            </div>

            <div style={{ flex: 1, overflowY: 'auto', border: '1px solid var(--border-primary)', borderRadius: 8, minHeight: 200, maxHeight: 340 }}>
              {filtered.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>查無會員</div>
              ) : filtered.map(m => (
                <label
                  key={m.id}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 14px', borderBottom: '1px solid var(--border-primary)', cursor: 'pointer', background: selected.has(m.id) ? 'rgba(34,211,238,0.08)' : 'transparent' }}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(m.id)}
                    onChange={() => toggle(m.id)}
                    style={{ accentColor: 'var(--accent-cyan)' }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 14 }}>{m.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{m.phone} · {m.member_number}</div>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{m.level ?? ''}</div>
                </label>
              ))}
            </div>

            <div style={{ marginTop: 10, fontSize: 13, color: 'var(--text-muted)' }}>已選取 {selected.size} 位</div>

            {err && <div style={{ color: 'var(--accent-red)', fontSize: 13, marginTop: 6 }}>{err}</div>}

            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <button onClick={onClose} style={S.ghostBtn}>取消</button>
              <button
                onClick={submit}
                disabled={saving || selected.size === 0}
                style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: 'none', background: selected.size === 0 ? 'var(--bg-tertiary)' : 'var(--accent-cyan)', color: selected.size === 0 ? 'var(--text-muted)' : '#fff', fontWeight: 700, fontSize: 15, cursor: selected.size === 0 ? 'not-allowed' : 'pointer' }}
              >
                {saving ? '發放中…' : `發放給 ${selected.size} 位會員`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const S = {
  ghostBtn: { padding: '10px 18px', borderRadius: 8, border: '1px solid var(--border-primary)', background: 'transparent', color: 'var(--text-secondary)', fontSize: 14, cursor: 'pointer' },
}
