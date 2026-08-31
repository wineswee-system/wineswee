import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Shuffle, ArrowDownAZ, Trash2, Hash, Volume2, VolumeX, Sparkles, X, RotateCw, History, Users } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { getTenantOrgId } from '../../lib/events/middleware/tenantContext'

// 幸運抽選遊戲機（轉盤 + 拉霸機／怪獸球風）— 純前端,名單/紀錄存 localStorage,不上傳。
// canvas / 球色用固定色值(CLAUDE.md 例外:JS 值餵 canvas 無法用 var())。
const PALETTE = ['#0ea5e9', '#f97316', '#22c55e', '#a855f7', '#ef4444', '#eab308', '#14b8a6', '#ec4899', '#3b82f6', '#84cc16', '#f43f5e', '#06b6d4']
const LS_KEY = 'wheel_spinner_names'
const LS_HIST = 'wheel_spinner_history'
const DEFAULT = '小明\n小華\n小美\n阿強\n阿珍\n大雄\n阿賢\n小芳'
const CAPTIONS = ['就是這瓶！', '恭喜中選 🍾', '本日幸運兒', '這瓶是你的了', '運氣不錯喔！', '就決定是你了', '出瓶成功！', '中啦～', '請笑納', '乾杯！']
const selSt = { flex: 1, padding: '7px 8px', borderRadius: 8, border: '1px solid var(--border-medium)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 13 }

const CSS = `
@keyframes wsBallDrop{0%{transform:translateY(-360px) scale(1)}55%{transform:translateY(0) scale(1)}66%{transform:translateY(0) scaleX(1.35) scaleY(.62)}78%{transform:translateY(-46px) scaleX(.9) scaleY(1.12)}90%{transform:translateY(0) scaleX(1.12) scaleY(.9)}100%{transform:translateY(0) scale(1)}}
@keyframes wsWobble{0%,100%{transform:rotate(0)}12%{transform:rotate(-18deg)}30%{transform:rotate(15deg)}48%{transform:rotate(-12deg)}66%{transform:rotate(9deg)}84%{transform:rotate(-5deg)}}
@keyframes wsLever{0%{transform:rotate(0)}35%{transform:rotate(72deg)}100%{transform:rotate(0)}}
@keyframes wsShake{0%,100%{transform:translate(0,0)}20%{transform:translate(-3px,2px)}40%{transform:translate(3px,-2px)}60%{transform:translate(-2px,-2px)}80%{transform:translate(2px,2px)}}
@keyframes wsFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-14px)}}
@keyframes wsRollOut{0%{transform:translate(-70px,-46px) rotate(-120deg);opacity:0}22%{opacity:1}55%{transform:translate(0,12px) rotate(18deg)}76%{transform:translate(0,-7px) rotate(-7deg)}100%{transform:translate(0,0) rotate(0)}}
@keyframes wsReadyPulse{0%,100%{box-shadow:0 0 0 0 rgba(255,203,5,.6),0 6px 14px rgba(0,0,0,.2)}50%{box-shadow:0 0 0 12px rgba(255,203,5,0),0 6px 14px rgba(0,0,0,.2)}}
@keyframes wsHint{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
@keyframes wsRays{0%{opacity:0;transform:translate(-50%,-50%) scale(.2) rotate(0)}25%{opacity:.9}100%{opacity:0;transform:translate(-50%,-50%) scale(2.7) rotate(160deg)}}
@keyframes wsRing{0%{opacity:.95;transform:translate(-50%,-50%) scale(.1)}100%{opacity:0;transform:translate(-50%,-50%) scale(3.2)}}
@keyframes wsFlash{0%{opacity:0}14%{opacity:.95}100%{opacity:0}}
@keyframes wsNamePop{0%{opacity:0;transform:translate(-50%,-50%) scale(0) rotate(-14deg)}55%{opacity:1;transform:translate(-50%,-50%) scale(1.3) rotate(6deg)}100%{opacity:1;transform:translate(-50%,-50%) scale(1) rotate(0)}}
@keyframes wsReadyGlow{0%,100%{filter:drop-shadow(0 0 6px rgba(255,203,5,.55))}50%{filter:drop-shadow(0 0 18px rgba(255,203,5,.95))}}
@keyframes wsShatter{0%{transform:translateX(-50%) scale(1) rotate(0)}18%{transform:translateX(-50%) scale(1.12) rotate(-5deg)}36%{transform:translateX(-50%) scale(1.05) rotate(5deg)}100%{transform:translateX(-50%) scale(.5) rotate(-10deg);opacity:0}}
@keyframes wsShard{to{transform:translate(var(--tx),var(--ty)) rotate(var(--rot));opacity:0}}
@keyframes wsSplash{0%{opacity:.9;transform:translate(-50%,-50%) scale(.2)}100%{opacity:0;transform:translate(-50%,-50%) scale(2.5)}}
.ws-btl{animation:wsRollOut .8s cubic-bezier(.34,1.4,.5,1) both}
.ws-btl.wobble{animation:wsWobble 1.05s ease-in-out 1 both}
.ws-btl.ready{cursor:pointer;animation:wsReadyGlow 1.1s ease-in-out infinite}
.ws-btl .ws-glass{transition:transform .3s}
.ws-btl.open .ws-glass{animation:wsShatter .5s ease-in both}
.ws-btl .ws-name{opacity:0;transform:translate(-50%,-50%) scale(0)}
.ws-btl.open .ws-name{animation:wsNamePop .55s cubic-bezier(.34,1.9,.6,1) both}
.ws-shard,.ws-splash,.ws-rays,.ws-ring,.ws-flash{position:absolute;top:50%;left:50%;opacity:0;pointer-events:none}
.ws-btl.open .ws-rays{width:210px;height:210px;background:repeating-conic-gradient(from 0deg,rgba(255,230,109,.9) 0 6deg,transparent 6deg 15deg);border-radius:50%;animation:wsRays .8s ease-out both}
.ws-btl.open .ws-ring{width:66px;height:66px;border:5px solid #ffcb05;border-radius:50%;animation:wsRing .6s ease-out both}
.ws-btl.open .ws-flash{width:130px;height:130px;background:radial-gradient(rgba(255,255,255,.95),transparent 70%);border-radius:50%;animation:wsFlash .5s ease-out both}
.ws-btl.open .ws-splash{width:120px;height:120px;background:radial-gradient(rgba(124,20,38,.85),transparent 66%);border-radius:50%;animation:wsSplash .55s ease-out both}
.ws-btl.open .ws-shard{opacity:1;animation:wsShard .6s ease-out both}
.ws-hint{animation:wsHint .8s ease-in-out infinite}
`

// 紅酒瓶(品牌感)— 純 CSS 畫;掉出→晃動→待點(發光)→點一下破瓶(碎片濺灑+召喚光)
function Bottle({ phase, name, caption, onOpen }) {
  const cls = 'ws-btl' + (phase === 'wobble' ? ' wobble' : '') + (phase === 'ready' ? ' ready' : '') + (phase === 'open' ? ' open' : '')
  const open = phase === 'open'
  const shards = useMemo(() => Array.from({ length: 9 }, (_, i) => {
    const a = (i / 9) * 2 * Math.PI + Math.random() * 0.6, dist = 55 + Math.random() * 45
    return { tx: `${Math.cos(a) * dist}px`, ty: `${Math.sin(a) * dist - 10}px`, rot: `${Math.random() * 720 - 360}deg`, s: 6 + Math.random() * 7 }
  }), [])
  return (
    <div style={{ position: 'relative', width: 74, height: 152, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div className={cls} onClick={() => phase === 'ready' && onOpen && onOpen()} style={{ position: 'relative', width: 74, height: 130 }}>
        {/* 召喚 / 破瓶特效 */}
        <div className="ws-rays" style={{ zIndex: 1 }} />
        <div className="ws-splash" style={{ zIndex: 1 }} />
        <div className="ws-flash" style={{ zIndex: 2 }} />
        <div className="ws-ring" style={{ zIndex: 2 }} />
        {shards.map((sh, i) => (
          <div key={i} className="ws-shard" style={{ width: sh.s, height: sh.s * 1.7, background: '#6d1226', zIndex: 4, clipPath: 'polygon(50% 0,100% 100%,0 100%)', '--tx': sh.tx, '--ty': sh.ty, '--rot': sh.rot }} />
        ))}
        {/* 酒瓶本體 */}
        {!open && (
          <div className="ws-glass" style={{ position: 'absolute', left: '50%', top: 2, transform: 'translateX(-50%)', zIndex: 3 }}>
            <div style={{ width: 15, height: 13, background: '#7a1020', margin: '0 auto', borderRadius: '3px 3px 0 0' }} />
            <div style={{ width: 17, height: 32, background: 'linear-gradient(90deg,#3a0a14,#7a1728,#3a0a14)', margin: '0 auto' }} />
            <div style={{ width: 48, height: 78, background: 'linear-gradient(90deg,#360a13,#7a1728 42%,#a52440 55%,#360a13)', borderRadius: '14px 14px 8px 8px', margin: '-2px auto 0', position: 'relative', boxShadow: 'inset 0 0 8px rgba(0,0,0,.5)' }}>
              <div style={{ position: 'absolute', top: 22, left: 5, right: 5, height: 38, background: '#f4ecd8', borderRadius: 3, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#7a1728', fontWeight: 900 }}>
                <span style={{ fontSize: 15 }}>🍾</span><span style={{ fontSize: 7, letterSpacing: 1 }}>WINE</span>
              </div>
            </div>
          </div>
        )}
        {/* 中獎者 */}
        <div className="ws-name" style={{ position: 'absolute', top: '42%', left: '50%', minWidth: 132, textAlign: 'center', zIndex: 6 }}>
          <div style={{ fontSize: 19, fontWeight: 900, color: '#14283c', background: '#fff', borderRadius: 10, padding: '4px 12px', boxShadow: '0 4px 14px rgba(0,0,0,.25)', border: '2px solid #ffcb05', whiteSpace: 'nowrap' }}>{name}</div>
          <div style={{ fontSize: 11, color: '#ef4444', fontWeight: 700, marginTop: 4 }}>{caption}</div>
        </div>
      </div>
      {phase === 'ready' && <div className="ws-hint" style={{ marginTop: 2, fontSize: 11, fontWeight: 800, color: 'var(--accent-orange)' }}>👆 開瓶!</div>}
    </div>
  )
}

export default function WheelSpinner() {
  const navigate = useNavigate()
  const [mode, setMode] = useState('slot') // 'wheel' | 'slot'
  const [text, setText] = useState(() => localStorage.getItem(LS_KEY) || DEFAULT)
  const [pickCount, setPickCount] = useState(1)
  const [removeWinner, setRemoveWinner] = useState(true)
  const [soundOn, setSoundOn] = useState(true)
  const [confettiOn, setConfettiOn] = useState(true)
  const [hist, setHist] = useState(() => { try { return JSON.parse(localStorage.getItem(LS_HIST) || '[]') } catch { return [] } })
  const { profile } = useAuth()
  const [emps, setEmps] = useState([])
  const [showImp, setShowImp] = useState(false)
  const [impStore, setImpStore] = useState('')
  const [impDept, setImpDept] = useState('')

  useEffect(() => {
    const orgId = profile?.organization_id ?? getTenantOrgId()
    if (!orgId) return
    supabase.from('employees')
      .select('name, store, store_id, dept, department_id, status')
      .eq('organization_id', orgId).eq('status', '在職').order('name')
      .then(({ data }) => setEmps(data || []))
  }, [profile?.organization_id])

  const impStores = useMemo(() => [...new Set(emps.map(e => e.store).filter(Boolean))].sort(), [emps])
  const impDepts = useMemo(() => [...new Set(emps.map(e => e.dept).filter(Boolean))].sort(), [emps])
  const impFiltered = useMemo(() => emps.filter(e => (!impStore || e.store === impStore) && (!impDept || e.dept === impDept)), [emps, impStore, impDept])
  const importEmps = (append) => {
    const list = impFiltered.map(e => e.name)
    if (list.length === 0) { alert('這個條件沒有員工'); return }
    setText(prev => append ? [...prev.split('\n').map(s => s.trim()).filter(Boolean), ...list].filter((v, i, a) => a.indexOf(v) === i).join('\n') : list.join('\n'))
    setShowImp(false)
  }

  const names = useMemo(() => text.split('\n').map(s => s.trim()).filter(Boolean), [text])
  useEffect(() => { localStorage.setItem(LS_KEY, text) }, [text])
  useEffect(() => { localStorage.setItem(LS_HIST, JSON.stringify(hist.slice(0, 100))) }, [hist])

  const confettiRef = useRef(null)
  const acRef = useRef(null)
  const beep = (f = 760, d = 0.02, type = 'square', g = 0.04) => {
    if (!soundOn) return
    try {
      const AC = window.AudioContext || window.webkitAudioContext
      const ac = acRef.current || (acRef.current = new AC())
      const o = ac.createOscillator(), gn = ac.createGain()
      o.type = type; o.frequency.value = f; gn.gain.value = g
      o.connect(gn); gn.connect(ac.destination); o.start(); o.stop(ac.currentTime + d)
    } catch { /* noop */ }
  }
  // 揭曉號角:登 登 登～登登(通用慶祝小號,非特定曲)
  const ding = () => {
    if (!soundOn) return
    try {
      const AC = window.AudioContext || window.webkitAudioContext
      const ac = acRef.current || (acRef.current = new AC())
      const seq = [[523, 0, 0.13], [523, 0.16, 0.13], [659, 0.32, 0.13], [784, 0.50, 0.22], [1047, 0.74, 0.4]]
      seq.forEach(([f, t, d]) => {
        const o = ac.createOscillator(), g = ac.createGain()
        o.type = 'triangle'; o.frequency.value = f
        const st = ac.currentTime + t
        g.gain.setValueAtTime(0.0001, st); g.gain.exponentialRampToValueAtTime(0.16, st + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, st + d)
        o.connect(g); g.connect(ac.destination); o.start(st); o.stop(st + d + 0.03)
      })
    } catch { /* noop */ }
  }

  const burstConfetti = () => {
    const cv = confettiRef.current; if (!cv) return
    const ctx = cv.getContext('2d')
    const W = cv.width = cv.offsetWidth, H = cv.height = cv.offsetHeight
    const parts = Array.from({ length: 130 }, () => ({ x: W / 2, y: H * 0.4, vx: (Math.random() - 0.5) * 15, vy: Math.random() * -13 - 3, c: PALETTE[Math.floor(Math.random() * PALETTE.length)], s: 4 + Math.random() * 7, r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3 }))
    let f = 0
    const step = () => { ctx.clearRect(0, 0, W, H); f++; parts.forEach(p => { p.vy += 0.35; p.x += p.vx; p.y += p.vy; p.r += p.vr; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6); ctx.restore() }); if (f < 140) requestAnimationFrame(step); else ctx.clearRect(0, 0, W, H) }
    step()
  }

  const recordWin = (winners) => {
    const at = new Date().toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    setHist(prev => [{ names: winners, at, mode }, ...prev].slice(0, 100))
    if (removeWinner) setText(prev => prev.split('\n').filter(l => !winners.includes(l.trim())).join('\n'))
  }

  const shuffle = () => setText(names.map(v => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map(x => x[1]).join('\n'))
  const sortAsc = () => setText([...names].sort((a, b) => a.localeCompare(b, 'zh-Hant')).join('\n'))
  const genRange = () => {
    const s = window.prompt('產生數字範圍(例如 1-100)', '1-30'); if (!s) return
    const m = s.match(/(\d+)\s*[-~到]\s*(\d+)/); if (!m) return
    let a = +m[1], b = +m[2]; if (a > b)[a, b] = [b, a]
    if (b - a > 500) { alert('範圍太大(上限 500)'); return }
    const arr = []; for (let i = a; i <= b; i++) arr.push(String(i)); setText(arr.join('\n'))
  }

  const pickWinners = (k) => {
    const pool = [...names], out = []
    for (let i = 0; i < k && pool.length; i++) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0])
    return out
  }

  return (
    <div className="fade-in" style={{ position: 'relative' }}>
      <style>{CSS}</style>
      {/* 背景:酒香氛圍 */}
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 0 }}>
        <div style={{ position: 'absolute', top: '-12%', left: '-6%', width: 360, height: 360, borderRadius: '50%', background: 'radial-gradient(rgba(165,36,64,.16),transparent 70%)' }} />
        <div style={{ position: 'absolute', bottom: '-10%', right: '-6%', width: 420, height: 420, borderRadius: '50%', background: 'radial-gradient(rgba(255,203,5,.13),transparent 70%)' }} />
        {['6%', '86%', '78%', '12%', '48%'].map((l, i) => (
          <div key={i} style={{ position: 'absolute', left: l, top: ['12%', '20%', '64%', '76%', '88%'][i], fontSize: [48, 34, 56, 30, 40][i], opacity: 0.12, animation: `wsFloat ${4 + i}s ease-in-out ${i * 0.5}s infinite` }}>🍾</div>
        ))}
      </div>

      <div className="page-header" style={{ position: 'relative', zIndex: 1 }}><div className="page-header-row">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="btn btn-secondary" onClick={() => navigate('/process/applications')} style={{ padding: '6px 10px' }}><ChevronLeft size={16} /></button>
          <div><h2><span className="header-icon">🎰</span> 幸運抽選機</h2><p>丟球抽選 · 隨機公平 · 資料不上傳</p></div>
        </div>
        <div style={{ display: 'flex', gap: 4, background: 'var(--bg-secondary)', padding: 4, borderRadius: 10 }}>
          {[['slot', '🎰 拉霸機'], ['wheel', '🎡 轉盤']].map(([m, l]) => (
            <button key={m} onClick={() => setMode(m)} style={{ padding: '7px 14px', borderRadius: 7, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, background: mode === m ? 'var(--accent-cyan)' : 'transparent', color: mode === m ? '#fff' : 'var(--text-secondary)' }}>{l}</button>
          ))}
        </div>
      </div></div>

      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start', position: 'relative', zIndex: 1 }}>
        <div style={{ flex: '1 1 460px', minWidth: 320 }}>
          {mode === 'slot'
            ? <SlotMachine names={names} pickWinners={pickWinners} pickCount={pickCount} onWin={recordWin} beep={beep} ding={ding} confetti={confettiOn ? burstConfetti : null} />
            : <WheelMode names={names} onWin={recordWin} beep={beep} confetti={confettiOn ? burstConfetti : null} />}
        </div>

        {/* 名單 + 設定 + 紀錄 */}
        <div style={{ flex: '1 1 300px', minWidth: 280, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card" style={{ padding: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontWeight: 700 }}>名單 <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 13 }}>({names.length})</span></div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-sm btn-secondary" title="帶入員工" onClick={() => setShowImp(v => !v)} style={{ color: 'var(--accent-cyan)' }}><Users size={13} /></button>
                <button className="btn btn-sm btn-secondary" title="產生數字" onClick={genRange}><Hash size={13} /></button>
                <button className="btn btn-sm btn-secondary" title="洗牌" onClick={shuffle}><Shuffle size={13} /></button>
                <button className="btn btn-sm btn-secondary" title="排序" onClick={sortAsc}><ArrowDownAZ size={13} /></button>
                <button className="btn btn-sm btn-secondary" title="清空" onClick={() => setText('')} style={{ color: 'var(--accent-red)' }}><Trash2 size={13} /></button>
              </div>
            </div>

            {showImp && (
              <div style={{ marginBottom: 10, padding: 12, borderRadius: 10, border: '1px solid var(--accent-cyan)', background: 'var(--accent-cyan-dim)' }}>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 5 }}><Users size={13} /> 帶入在職員工</div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <select value={impStore} onChange={e => setImpStore(e.target.value)} style={selSt}>
                    <option value="">全部門市</option>
                    {impStores.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <select value={impDept} onChange={e => setImpDept(e.target.value)} style={selSt}>
                    <option value="">全部部門</option>
                    {impDepts.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button className="btn btn-sm btn-primary" onClick={() => importEmps(false)} style={{ flex: 1 }}>帶入 {impFiltered.length} 位（取代）</button>
                  <button className="btn btn-sm btn-secondary" onClick={() => importEmps(true)}>追加</button>
                </div>
              </div>
            )}
            <textarea value={text} onChange={e => setText(e.target.value)} placeholder="一行一個名字…" spellCheck={false}
              style={{ width: '100%', height: 210, resize: 'vertical', padding: 12, borderRadius: 10, border: '1px solid var(--border-medium)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 14, lineHeight: 1.7, boxSizing: 'border-box', fontFamily: 'inherit' }} />
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderRadius: 10, border: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)' }}>
                <span style={{ fontSize: 14 }}>一次抽幾位</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button className="btn btn-sm btn-secondary" onClick={() => setPickCount(v => Math.max(1, v - 1))}>−</button>
                  <span style={{ fontWeight: 800, minWidth: 20, textAlign: 'center' }}>{pickCount}</span>
                  <button className="btn btn-sm btn-secondary" onClick={() => setPickCount(v => Math.min(10, v + 1))}>＋</button>
                </div>
              </div>
              <Toggle label="抽中後自動移除" on={removeWinner} set={setRemoveWinner} />
              <Toggle label="音效" on={soundOn} set={setSoundOn} icon={soundOn ? <Volume2 size={14} /> : <VolumeX size={14} />} />
              <Toggle label="中獎彩帶" on={confettiOn} set={setConfettiOn} icon={<Sparkles size={14} />} />
            </div>
          </div>

          <div className="card" style={{ padding: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}><History size={15} /> 中獎紀錄</div>
              {hist.length > 0 && <button className="btn btn-sm btn-secondary" onClick={() => setHist([])} style={{ color: 'var(--accent-red)' }}>清空</button>}
            </div>
            {hist.length === 0
              ? <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 0' }}>還沒抽過</div>
              : <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {hist.map((h, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '6px 10px', borderRadius: 8, background: 'var(--bg-secondary)', fontSize: 13 }}>
                    <span style={{ fontWeight: 600, color: 'var(--accent-cyan)' }}>{h.names.join('、')}</span>
                    <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap', fontSize: 11 }}>{h.mode === 'slot' ? '🎰' : '🎡'} {h.at}</span>
                  </div>
                ))}
              </div>}
          </div>
        </div>
      </div>

      <canvas ref={confettiRef} style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 9998 }} />
    </div>
  )
}

// ══════════ 拉霸機（怪獸球）══════════
function SlotMachine({ names, pickWinners, pickCount, onWin, beep, ding, confetti }) {
  const [reel, setReel] = useState('？？？')
  const [balls, setBalls] = useState([])
  const [busy, setBusy] = useState(false)
  const [lever, setLever] = useState(false)
  const timers = useRef([])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  const T = (fn, ms) => { const id = setTimeout(fn, ms); timers.current.push(id); return id }

  const pull = () => {
    if (busy || names.length < 1) return
    setBusy(true); setBalls([]); setLever(true); T(() => setLever(false), 500)
    const k = Math.min(pickCount, names.length)
    let delay = 42, elapsed = 0
    const cycle = () => {
      setReel(names[Math.floor(Math.random() * names.length)]); beep(600 + Math.random() * 300, 0.015)
      elapsed += delay; delay *= 1.10
      if (elapsed < 4200) T(cycle, delay); else drop(k)
    }
    cycle()
  }

  const drop = (k) => {
    setReel('🎉')
    const winners = pickWinners(k)
    onWin(winners) // 結果已定:記錄 + 移除;球留給使用者點開揭曉
    winners.forEach((w, i) => {
      T(() => {
        const id = `${Date.now()}-${i}`, caption = CAPTIONS[Math.floor(Math.random() * CAPTIONS.length)]
        setBalls(prev => [...prev, { id, name: w, caption, phase: 'drop' }])
        beep(300, 0.05, 'sine', 0.05)
        T(() => setBalls(prev => prev.map(b => b.id === id ? { ...b, phase: 'wobble' } : b)), 720)
        T(() => setBalls(prev => prev.map(b => b.id === id ? { ...b, phase: 'ready' } : b)), 1780)
      }, i * 520)
    })
    T(() => { setBusy(false); setReel('？？？') }, winners.length * 520 + 1900)
  }

  const openBall = (id) => {
    setBalls(prev => prev.map(b => (b.id === id && b.phase === 'ready') ? { ...b, phase: 'open' } : b))
    ding(); if (confetti) confetti()
  }

  return (
    <div className="card" style={{ padding: 22, display: 'flex', flexDirection: 'column', alignItems: 'center' }} data-slot={busy ? '1' : '0'}>
      {/* 自動販賣機 */}
      <div style={{ position: 'relative', width: '100%', maxWidth: 380, animation: busy ? 'wsShake .28s linear infinite' : 'none' }}>
        <div style={{ borderRadius: 20, padding: 16, background: 'linear-gradient(160deg,#8a1e30,#4a0d1a)', boxShadow: '0 14px 36px rgba(0,0,0,.32)', border: '5px solid #2a0810' }}>
          <div style={{ textAlign: 'center', color: '#ffd7a0', fontWeight: 900, letterSpacing: 2, fontSize: 15, marginBottom: 12 }}>🍾 自動抽選機</div>
          {/* 選號螢幕 */}
          <div style={{ background: '#0b1220', borderRadius: 12, padding: '18px 12px', textAlign: 'center', border: '3px solid #ffcb05', boxShadow: 'inset 0 4px 14px rgba(0,0,0,.6)', marginBottom: 12 }}>
            <div style={{ fontSize: 30, fontWeight: 900, color: '#ffe66d', minHeight: 40, filter: busy ? 'blur(.6px)' : 'none', wordBreak: 'break-all', textShadow: '0 0 12px rgba(255,203,5,.5)' }}>{reel}</div>
          </div>
          {/* 玻璃展示櫃 */}
          <div style={{ position: 'relative', background: 'linear-gradient(#1c2230,#2a3346)', borderRadius: 10, padding: '10px 6px', border: '3px solid #3a4658', display: 'flex', flexDirection: 'column', gap: 8, overflow: 'hidden' }}>
            {[0, 1].map(r => (
              <div key={r} style={{ display: 'flex', justifyContent: 'space-around' }}>
                {[0, 1, 2, 3, 4].map(c => <span key={c} style={{ fontSize: 22, filter: 'saturate(.85)' }}>🍾</span>)}
              </div>
            ))}
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(120deg,rgba(255,255,255,.2),rgba(255,255,255,.04) 40%,transparent 70%)', pointerEvents: 'none' }} />
          </div>
          {/* 取物口 */}
          <div style={{ marginTop: 12, background: '#160308', borderRadius: '6px 6px 10px 10px', padding: '9px 12px', border: '3px solid #2a0810' }}>
            <div style={{ height: 11, background: '#000', borderRadius: 3, boxShadow: 'inset 0 3px 8px rgba(0,0,0,.9)' }} />
            <div style={{ fontSize: 10, color: '#c98a72', marginTop: 5, letterSpacing: 3, textAlign: 'center' }}>取 物 口</div>
          </div>
        </div>
      </div>

      {/* 取物托盤:滾出來的酒瓶 */}
      <div style={{ minHeight: 168, marginTop: 16, padding: '10px 8px', display: 'flex', gap: 14, flexWrap: 'wrap', justifyContent: 'center', alignItems: 'flex-start', width: '100%', maxWidth: 420, borderRadius: 12, background: balls.length ? 'var(--bg-secondary)' : 'transparent', transition: 'background .3s' }}>
        {balls.map(b => <Bottle key={b.id} phase={b.phase} name={b.name} caption={b.caption} onOpen={() => openBall(b.id)} />)}
      </div>

      <button onClick={pull} disabled={busy || names.length < 1} style={{
        marginTop: 4, padding: '13px 44px', borderRadius: 14, border: 'none', fontSize: 18, fontWeight: 900,
        background: busy || names.length < 1 ? 'var(--bg-secondary)' : 'linear-gradient(135deg,#a52440,#7a1728)',
        color: busy || names.length < 1 ? 'var(--text-muted)' : '#fff', cursor: busy || names.length < 1 ? 'default' : 'pointer',
        boxShadow: busy ? 'none' : '0 6px 0 #4a0d1a', transition: 'transform .1s',
      }}>{busy ? '🎲 抽選中…' : '🍾 出瓶！'}</button>
    </div>
  )
}

// ══════════ 轉盤 ══════════
function WheelMode({ names, onWin, beep, confetti }) {
  const canvasRef = useRef(null), rotRef = useRef(0), rafRef = useRef(null)
  const [spinning, setSpinning] = useState(false)
  const [winner, setWinner] = useState(null)
  useEffect(() => () => cancelAnimationFrame(rafRef.current), [])

  const draw = useCallback(() => {
    const cv = canvasRef.current; if (!cv) return
    const ctx = cv.getContext('2d'); const size = cv.width, R = size / 2
    ctx.clearRect(0, 0, size, size); ctx.save(); ctx.translate(R, R); ctx.rotate(rotRef.current)
    const N = names.length
    if (N === 0) { ctx.beginPath(); ctx.arc(0, 0, R - 8, 0, 2 * Math.PI); ctx.fillStyle = '#e2e8f0'; ctx.fill(); ctx.restore(); ctx.fillStyle = '#94a3b8'; ctx.font = 'bold 18px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('請先輸入名單', R, R + 6); return }
    const seg = (2 * Math.PI) / N
    for (let i = 0; i < N; i++) {
      const a0 = i * seg
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R - 8, a0, a0 + seg); ctx.closePath(); ctx.fillStyle = PALETTE[i % PALETTE.length]; ctx.fill()
      ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 2; ctx.stroke()
      ctx.save(); ctx.rotate(a0 + seg / 2); ctx.textAlign = 'right'; ctx.fillStyle = '#fff'; ctx.font = `bold ${N > 18 ? 12 : 15}px -apple-system,"PingFang TC",sans-serif`
      const l = names[i].length > 11 ? names[i].slice(0, 10) + '…' : names[i]; ctx.fillText(l, R - 20, 5); ctx.restore()
    }
    ctx.restore()
    // 中心怪獸球
    const rr = 34; ctx.save(); ctx.translate(R, R)
    ctx.beginPath(); ctx.arc(0, 0, rr, Math.PI, 2 * Math.PI); ctx.closePath(); ctx.fillStyle = '#ee1515'; ctx.fill()
    ctx.beginPath(); ctx.arc(0, 0, rr, 0, Math.PI); ctx.closePath(); ctx.fillStyle = '#f4f4f5'; ctx.fill()
    ctx.fillStyle = '#1a1a1a'; ctx.fillRect(-rr, -4, rr * 2, 8)
    ctx.beginPath(); ctx.arc(0, 0, rr, 0, 2 * Math.PI); ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 3; ctx.stroke()
    ctx.beginPath(); ctx.arc(0, 0, 11, 0, 2 * Math.PI); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = '#1a1a1a'; ctx.stroke()
    ctx.restore()
  }, [names])
  useEffect(() => { draw() }, [draw])

  const spin = () => {
    if (spinning || names.length < 2) return
    setSpinning(true); setWinner(null)
    const N = names.length, seg = (2 * Math.PI) / N, start = rotRef.current
    const target = start + (6 + Math.random() * 3) * 2 * Math.PI + Math.random() * 2 * Math.PI
    const dur = 4200 + Math.random() * 900, t0 = performance.now(); let last = -1
    const ease = t => 1 - Math.pow(1 - t, 3)
    const frame = (now) => {
      const t = Math.min(1, (now - t0) / dur); rotRef.current = start + (target - start) * ease(t)
      const cur = Math.floor((rotRef.current % (2 * Math.PI)) / seg); if (cur !== last) { last = cur; beep(760, 0.02) }
      draw(); if (t < 1) rafRef.current = requestAnimationFrame(frame)
      else { const local = (((3 * Math.PI / 2 - rotRef.current) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI); const idx = Math.floor(local / seg) % N; setSpinning(false); setWinner(names[idx]); onWin([names[idx]]); if (confetti) confetti() }
    }
    rafRef.current = requestAnimationFrame(frame)
  }

  return (
    <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ position: 'relative', width: '100%', maxWidth: 460, aspectRatio: '1' }}>
        <div style={{ position: 'absolute', top: -4, left: '50%', transform: 'translateX(-50%)', zIndex: 3, width: 0, height: 0, borderLeft: '16px solid transparent', borderRight: '16px solid transparent', borderTop: '30px solid var(--accent-red)', filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.3))' }} />
        <canvas ref={canvasRef} width={460} height={460} onClick={spin} style={{ width: '100%', height: '100%', borderRadius: '50%', cursor: spinning ? 'default' : 'pointer', boxShadow: '0 8px 30px rgba(0,0,0,.18)' }} />
      </div>
      <button onClick={spin} disabled={spinning || names.length < 2} style={{ marginTop: 18, padding: '12px 40px', borderRadius: 12, border: 'none', fontSize: 17, fontWeight: 800, background: spinning || names.length < 2 ? 'var(--bg-secondary)' : 'linear-gradient(135deg,#0e7490,#0891b2)', color: spinning || names.length < 2 ? 'var(--text-muted)' : '#fff', cursor: spinning || names.length < 2 ? 'default' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 }}><RotateCw size={18} /> {spinning ? '轉動中…' : '開始抽選'}</button>

      {winner != null && (
        <div onClick={() => setWinner(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-card)', borderRadius: 18, padding: '32px 40px', textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,.4)', minWidth: 280, border: '1px solid var(--border-medium)' }}>
            <div style={{ fontSize: 13, letterSpacing: 4, color: 'var(--accent-cyan)', fontWeight: 700 }}>🎉 中 獎 者</div>
            <div style={{ fontSize: 34, fontWeight: 900, margin: '10px 0 20px', wordBreak: 'break-all' }}>{winner}</div>
            <button className="btn btn-primary" onClick={() => setWinner(null)}><X size={14} /> 關閉</button>
          </div>
        </div>
      )}
    </div>
  )
}

function Toggle({ label, on, set, icon }) {
  return (
    <button onClick={() => set(v => !v)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 12px', borderRadius: 10, border: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)', cursor: 'pointer', color: 'var(--text-primary)', fontSize: 14 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{icon}{label}</span>
      <span style={{ width: 40, height: 22, borderRadius: 22, background: on ? 'var(--accent-cyan)' : 'var(--border-medium)', position: 'relative', transition: 'background .15s', flexShrink: 0 }}>
        <span style={{ position: 'absolute', top: 2, left: on ? 20 : 2, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
      </span>
    </button>
  )
}
