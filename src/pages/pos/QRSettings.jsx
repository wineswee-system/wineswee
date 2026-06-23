import { useState, useEffect } from 'react'
import { QrCode, ChevronDown, Save, Info } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useOrgId } from '../../contexts/AuthContext'
import { toast } from '../../lib/toast'
import PageHeader from '../../components/ui/PageHeader'
import LoadingSpinner from '../../components/LoadingSpinner'

const inp = {
  background: 'var(--bg-input)', border: '1px solid var(--border-medium)',
  borderRadius: 8, color: 'var(--text-primary)', padding: '8px 12px', fontSize: 14, outline: 'none',
}
const sel = { ...inp, cursor: 'pointer', appearance: 'none', width: '100%' }

const DEFAULTS = { qr_ordering_enabled: false, qr_approval_mode: 'manual', qr_session_minutes: 240 }

export default function QRSettings() {
  const orgId = useOrgId()
  const [stores, setStores]     = useState([])
  const [storeId, setStoreId]   = useState(null)
  const [settings, setSettings] = useState(DEFAULTS)
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)

  const set = (k, v) => setSettings(s => ({ ...s, [k]: v }))

  // ── Stores ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!orgId) return
    supabase.from('stores').select('id, name').eq('organization_id', orgId).order('name')
      .then(({ data }) => {
        setStores(data ?? [])
        if (data?.length) setStoreId(id => id ?? data[0].id)
      })
  }, [orgId])

  // ── Load settings for selected store ────────────────────────────────────────
  useEffect(() => {
    if (!storeId || !orgId) return
    setLoading(true)
    supabase.from('pos_store_settings')
      .select('qr_ordering_enabled, qr_approval_mode, qr_session_minutes')
      .eq('organization_id', orgId)
      .eq('store_id', storeId)
      .maybeSingle()
      .then(({ data }) => {
        setSettings(data ?? DEFAULTS)
        setLoading(false)
      })
  }, [storeId, orgId])

  // ── Save ─────────────────────────────────────────────────────────────────────
  async function save() {
    if (!storeId) return
    const mins = Number(settings.qr_session_minutes)
    if (!mins || mins < 30 || mins > 1440) {
      toast.error('連結時效請填 30~1440 分鐘')
      return
    }
    setSaving(true)
    const payload = {
      organization_id: orgId,
      store_id: storeId,
      qr_ordering_enabled: settings.qr_ordering_enabled,
      qr_approval_mode: settings.qr_approval_mode,
      qr_session_minutes: mins,
      updated_at: new Date().toISOString(),
    }
    const { error } = await supabase.from('pos_store_settings')
      .upsert(payload, { onConflict: 'organization_id,store_id' })
    setSaving(false)
    if (error) { toast.error('儲存失敗：' + error.message); return }
    toast.success('設定已儲存')
  }

  return (
    <div style={{ padding: '24px 28px', maxWidth: 720 }}>
      <PageHeader
        icon={QrCode}
        title="QR 點餐設定"
        description="設定每間門市的桌邊 QR 自助點餐功能與確認模式"
        accentColor="var(--accent-cyan)"
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ position: 'relative' }}>
              <select value={storeId ?? ''} onChange={e => setStoreId(e.target.value)} style={{ ...sel, width: 160, paddingRight: 32 }}>
                {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <ChevronDown size={13} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
            </div>
          </div>
        }
      />

      {loading ? <LoadingSpinner /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Enable toggle */}
          <Section title="QR 自助點餐">
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
              <div>
                <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: 15 }}>啟用 QR 自助點餐</div>
                <div style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
                  客人掃描桌上 QR Code 即可瀏覽菜單並自助下單；員工仍可隨時補充點餐
                </div>
              </div>
              <Toggle checked={settings.qr_ordering_enabled} onChange={v => set('qr_ordering_enabled', v)} />
            </label>
          </Section>

          {/* Approval mode */}
          <Section title="確認模式" disabled={!settings.qr_ordering_enabled}>
            {[
              { value: 'manual', label: '需員工確認', desc: '客人送出後，員工看到通知後點擊確認，再送廚房或出貨。適合人手充裕的場合。' },
              { value: 'auto',   label: '自動確認',   desc: '客人點餐後直接進入廚房序列，無需員工操作。適合尖峰時段減少確認步驟。' },
            ].map(opt => (
              <label key={opt.value} style={{
                display: 'flex', alignItems: 'flex-start', gap: 12, cursor: 'pointer',
                padding: '12px 16px', borderRadius: 8, border: `1px solid ${settings.qr_approval_mode === opt.value ? 'var(--accent-cyan)' : 'var(--border-subtle)'}`,
                background: settings.qr_approval_mode === opt.value ? 'rgba(34,211,238,0.08)' : 'var(--bg-tertiary)',
                opacity: settings.qr_ordering_enabled ? 1 : 0.5,
              }}>
                <input
                  type="radio" name="approval_mode" value={opt.value}
                  checked={settings.qr_approval_mode === opt.value}
                  disabled={!settings.qr_ordering_enabled}
                  onChange={() => set('qr_approval_mode', opt.value)}
                  style={{ marginTop: 2, accentColor: 'var(--accent-cyan)' }}
                />
                <div>
                  <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: 14 }}>{opt.label}</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 3, lineHeight: 1.5 }}>{opt.desc}</div>
                </div>
              </label>
            ))}
          </Section>

          {/* Session duration */}
          <Section title="連結時效" disabled={!settings.qr_ordering_enabled}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <input
                type="number" min={30} max={1440} step={30}
                value={settings.qr_session_minutes}
                onChange={e => set('qr_session_minutes', e.target.value)}
                disabled={!settings.qr_ordering_enabled}
                style={{ ...inp, width: 100, opacity: settings.qr_ordering_enabled ? 1 : 0.5 }}
              />
              <span style={{ color: 'var(--text-secondary)', fontSize: 14 }}>分鐘（從入座開始計算）</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, color: 'var(--text-muted)', fontSize: 12 }}>
              <Info size={13} />
              建議 120~480 分鐘（2~8 小時）。超時後 QR 失效，員工可在點餐頁重新產生。
            </div>
          </Section>

          {/* Save */}
          <div style={{ paddingTop: 8 }}>
            <button
              className="btn btn-primary"
              onClick={save}
              disabled={saving || !storeId}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}
            >
              <Save size={15} />
              {saving ? '儲存中…' : '儲存設定'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Section({ title, children, disabled }) {
  return (
    <div style={{
      background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border-subtle)',
      overflow: 'hidden', opacity: disabled ? 0.6 : 1,
    }}>
      <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-tertiary)' }}>
        <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-secondary)' }}>{title}</span>
      </div>
      <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {children}
      </div>
    </div>
  )
}

function Toggle({ checked, onChange }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      style={{
        flexShrink: 0, width: 48, height: 26, borderRadius: 13, border: 'none', cursor: 'pointer',
        background: checked ? 'var(--accent-cyan)' : 'var(--bg-tertiary)',
        position: 'relative', transition: 'background 0.2s',
      }}
    >
      <span style={{
        position: 'absolute', top: 3, left: checked ? 25 : 3,
        width: 20, height: 20, borderRadius: '50%',
        background: '#fff', transition: 'left 0.2s',
      }} />
    </button>
  )
}
