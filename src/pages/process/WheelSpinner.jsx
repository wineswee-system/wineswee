import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Shuffle, ArrowDownAZ, Trash2, Hash, Volume2, VolumeX, Sparkles, X, RotateCw, History, Users } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { getTenantOrgId } from '../../lib/events/middleware/tenantContext'

// 幸運抽選遊戲機(小瑪莉水果盤 + 轉盤)— 純前端,名單/紀錄存 localStorage,不上傳。
// canvas / 燈色用固定色值(CLAUDE.md 例外:JS 值餵 canvas 無法用 var())。
const PALETTE = ['#0ea5e9', '#f97316', '#22c55e', '#a855f7', '#ef4444', '#eab308', '#14b8a6', '#ec4899', '#3b82f6', '#84cc16', '#f43f5e', '#06b6d4']
const LS_KEY = 'wheel_spinner_names'
const LS_HIST = 'wheel_spinner_history'
const DEFAULT = '小明\n小華\n小美\n阿強\n阿珍\n大雄\n阿賢\n小芳'
const CAPTIONS = ['恭喜中選！', '就是你了', '本日幸運兒', '手氣不錯喔', '中啦～', '天選之人', '就決定是你', '幸運降臨', '抽到你了', '鏘鏘～']
const FRUITS = ['🍒', '🍊', '🍋', '🍇', '🔔', '🍎', '⭐', '🍉']
const selSt = { flex: 1, padding: '7px 8px', borderRadius: 8, border: '1px solid var(--border-medium)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 13 }

const CSS = `
@keyframes wsShake{0%,100%{transform:translate(0,0)}20%{transform:translate(-2px,1px)}40%{transform:translate(2px,-1px)}60%{transform:translate(-1px,-1px)}80%{transform:translate(1px,1px)}}
@keyframes wsFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-14px)}}
@keyframes wsCoinUp{0%{transform:translateY(0) rotate(0);opacity:1}60%{transform:translateY(-38px) rotate(200deg);opacity:1}100%{transform:translateY(-46px) rotate(380deg);opacity:0}}
@keyframes wsWinPop{0%{opacity:0;transform:scale(0) rotate(-12deg)}55%{opacity:1;transform:scale(1.22) rotate(5deg)}100%{opacity:1;transform:scale(1) rotate(0)}}
@keyframes wsTwinkle{0%,100%{opacity:.3}50%{opacity:1}}
@keyframes wsTitlePulse{0%,100%{opacity:.85;transform:scale(1)}50%{opacity:1;transform:scale(1.05)}}
@keyframes wsBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
@keyframes wsCheer{0%,100%{transform:translateY(0) rotate(-6deg)}50%{transform:translateY(-8px) rotate(6deg)}}
@keyframes wsMwin{0%{transform:translateY(0) scale(1)}30%{transform:translateY(-16px) scale(1.12)}60%{transform:translateY(0) scale(1)}80%{transform:translateY(-6px)}100%{transform:translateY(0)}}
.ws-coin{cursor:pointer;user-select:none;transition:transform .1s}
.ws-coin:hover{transform:translateY(-2px)}
.ws-coin.drop{animation:wsCoinUp .6s ease-in forwards;pointer-events:none}
.ws-win{animation:wsWinPop .5s cubic-bezier(.34,1.7,.6,1) both}
`

// 依名單數量排出「邊框方陣」— 名字均勻鋪在周邊格,其餘補水果;跑馬燈繞著周邊跑。
function computeBoard(list) {
  const N = Math.max(list.length, 1)
  let best = null
  for (let rows = 3; rows <= 12; rows++) for (let cols = 3; cols <= 12; cols++) {
    const p = 2 * (cols + rows) - 4
    if (p < Math.max(N, 12)) continue
    const score = (p - N) + Math.abs(cols - rows) * 0.7
    if (!best || score < best.score) best = { cols, rows, p, score }
  }
  if (!best) best = { cols: 5, rows: 5, p: 16 }
  const { cols, rows, p } = best
  const coords = []                                    // 周邊格順時針(左上→右上→右下→左下)
  for (let c = 0; c < cols; c++) coords.push([0, c])
  for (let r = 1; r < rows; r++) coords.push([r, cols - 1])
  for (let c = cols - 2; c >= 0; c--) coords.push([rows - 1, c])
  for (let r = rows - 2; r >= 1; r--) coords.push([r, 0])
  const cells = coords.map(([r, c], idx) => ({ r, c, idx, fruit: FRUITS[idx % FRUITS.length] }))
  const step = p / N                                   // step>=1 → floor 保證不撞格
  for (let i = 0; i < N; i++) cells[Math.floor(i * step)].name = list[i]
  return { cols, rows, p, cells }
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
  // 小瑪莉:抽完先從名單移除(防後續重複抽到);中獎紀錄等「停格揭曉」那刻才記
  const removeFromPool = (winners) => {
    if (removeWinner) setText(prev => prev.split('\n').filter(l => !winners.includes(l.trim())).join('\n'))
  }
  const recordOnly = (winners) => {
    const at = new Date().toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    setHist(prev => [{ names: winners, at, mode }, ...prev].slice(0, 100))
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
      {/* 背景:氛圍光暈 */}
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 0 }}>
        <div style={{ position: 'absolute', top: '-12%', left: '-6%', width: 360, height: 360, borderRadius: '50%', background: 'radial-gradient(rgba(192,31,47,.14),transparent 70%)' }} />
        <div style={{ position: 'absolute', bottom: '-10%', right: '-6%', width: 420, height: 420, borderRadius: '50%', background: 'radial-gradient(rgba(255,203,5,.13),transparent 70%)' }} />
        {['6%', '86%', '78%', '12%', '48%'].map((l, i) => (
          <div key={i} style={{ position: 'absolute', left: l, top: ['12%', '20%', '64%', '76%', '88%'][i], fontSize: [48, 34, 56, 30, 40][i], opacity: 0.1, animation: `wsFloat ${4 + i}s ease-in-out ${i * 0.5}s infinite` }}>{['🍒', '🍀', '⭐', '🔔', '🍊'][i]}</div>
        ))}
      </div>

      <div className="page-header" style={{ position: 'relative', zIndex: 1 }}><div className="page-header-row">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="btn btn-secondary" onClick={() => navigate('/process/applications')} style={{ padding: '6px 10px' }}><ChevronLeft size={16} /></button>
          <div><h2><span className="header-icon">🎰</span> 幸運抽選機</h2><p>投幣 · 跑燈抽選 · 隨機公平 · 資料不上傳</p></div>
        </div>
        <div style={{ display: 'flex', gap: 4, background: 'var(--bg-secondary)', padding: 4, borderRadius: 10 }}>
          {[['slot', '🍀 小瑪莉'], ['wheel', '🎡 轉盤']].map(([m, l]) => (
            <button key={m} onClick={() => setMode(m)} style={{ padding: '7px 14px', borderRadius: 7, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, background: mode === m ? 'var(--accent-cyan)' : 'transparent', color: mode === m ? '#fff' : 'var(--text-secondary)' }}>{l}</button>
          ))}
        </div>
      </div></div>

      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start', position: 'relative', zIndex: 1 }}>
        <div style={{ flex: '1 1 460px', minWidth: 320 }}>
          {mode === 'slot'
            ? <SlotMachine names={names} pickWinners={pickWinners} pickCount={pickCount} onDrop={removeFromPool} onReveal={recordOnly} beep={beep} ding={ding} confetti={confettiOn ? burstConfetti : null} />
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
                    <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap', fontSize: 11 }}>{h.mode === 'slot' ? '🍀' : '🎡'} {h.at}</span>
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

// ══════════ 小瑪莉(水果盤跑燈)══════════
function SlotMachine({ names, pickWinners, pickCount, onDrop, onReveal, beep, ding, confetti }) {
  const [spinning, setSpinning] = useState(false)
  const [board, setBoard] = useState([])
  const [lit, setLit] = useState(-1)
  const [reveal, setReveal] = useState(null)
  const [credits, setCredits] = useState(0)
  const [won, setWon] = useState(0)
  const [coinAnim, setCoinAnim] = useState(false)
  const timers = useRef([])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  const T = (fn, ms) => { const id = setTimeout(fn, ms); timers.current.push(id); return id }

  const ringNames = spinning ? board : names
  const layout = useMemo(() => computeBoard(ringNames), [ringNames])
  const pad = 8
  const cellPct = Math.max(8, Math.min(15, 74 / Math.max(layout.cols, layout.rows)))
  const fs = layout.cols <= 6 ? 12 : layout.cols <= 8 ? 10 : layout.cols <= 10 ? 9 : 8
  const shortName = n => (n && n.length > 4 ? n.slice(0, 4) + '…' : n)

  const insertCoin = () => {
    if (coinAnim || spinning) return
    setCoinAnim(true); beep(900, 0.05, 'square', 0.05); T(() => beep(1350, 0.06, 'square', 0.05), 70)
    T(() => { setCoinAnim(false); setCredits(c => Math.min(99, c + 1)) }, 600)
  }

  // 跑馬燈:繞周邊幾圈後減速,最後停在 targetSlot
  const runLight = (targetSlot, lay, onLand) => {
    const p = lay.p
    const loops = 3 + Math.floor(Math.random() * 2)
    const totalTicks = loops * p + targetSlot
    const ramp = Math.round(p * 1.7)
    let i = 0
    const tick = () => {
      setLit(i % p); beep(700 + Math.random() * 160, 0.018)
      if (i >= totalTicks) { onLand(); return }
      const remaining = totalTicks - i
      let delay = 30
      if (remaining <= ramp) { const t = 1 - remaining / ramp; delay = 30 + 290 * (t * t) }
      i++; T(tick, delay)
    }
    tick()
  }

  const spin = () => {
    if (spinning || credits < 1 || names.length < 1) return
    setCredits(c => c - 1); setReveal(null)
    const frozen = names.slice()
    const lay = computeBoard(frozen)          // 凍結本輪盤面(抽多位時中途移除也不重排)
    setBoard(frozen); setSpinning(true)
    const winners = pickWinners(Math.min(pickCount, frozen.length))
    let qi = 0
    const doNext = () => {
      if (qi >= winners.length) { setSpinning(false); setLit(-1); return }
      const w = winners[qi]
      const slot = lay.cells.findIndex(c => c.name === w)
      runLight(slot < 0 ? 0 : slot, lay, () => {
        setLit(slot); setWon(x => x + 1)
        setReveal({ name: w, caption: CAPTIONS[Math.floor(Math.random() * CAPTIONS.length)] })
        onReveal([w]); onDrop([w])            // ← 停格揭曉這刻才記中獎 + 從名單移除
        ding(); if (confetti) confetti()
        qi++
        T(() => { if (qi < winners.length) setReveal(null); doNext() }, 1600)
      })
    }
    doNext()
  }

  const canSpin = !spinning && credits >= 1 && names.length >= 1

  return (
    <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ width: '100%', maxWidth: 430, animation: spinning ? 'wsShake .3s linear infinite' : 'none' }}>
        {/* 機台外殼 */}
        <div style={{ background: 'linear-gradient(#f7f8fc,#dde1ea)', borderRadius: '22px 22px 14px 14px', padding: '14px 14px 12px', border: '3px solid #c3c9d6', boxShadow: '0 16px 40px rgba(0,0,0,.22)' }}>
          {/* LED 顯示 */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginBottom: 10 }}>
            <Led label="中獎" value={won} />
            <Led label="CREDIT" value={credits} amber />
          </div>
          {/* 水果盤 */}
          <div style={{ position: 'relative', width: '100%', aspectRatio: '1', overflow: 'hidden', background: 'radial-gradient(circle at 50% 42%,#12294a,#0a1424)', borderRadius: 14, border: '4px solid #c01f2f', boxShadow: 'inset 0 0 34px rgba(0,0,0,.75)' }}>
            {/* 角落燈泡 */}
            {[['4%', '4%'], ['96%', '4%'], ['96%', '96%'], ['4%', '96%']].map(([l, t], i) => (
              <div key={i} style={{ position: 'absolute', left: l, top: t, transform: 'translate(-50%,-50%)', width: 8, height: 8, borderRadius: '50%', background: '#ffd21a', boxShadow: '0 0 8px #ffd21a', animation: `wsTwinkle ${1 + i * 0.3}s ease-in-out infinite` }} />
            ))}
            {/* 周邊格 */}
            {layout.cells.map(cell => {
              const x = layout.cols > 1 ? pad + (cell.c / (layout.cols - 1)) * (100 - 2 * pad) : 50
              const y = layout.rows > 1 ? pad + (cell.r / (layout.rows - 1)) * (100 - 2 * pad) : 50
              const isLit = lit === cell.idx, isName = !!cell.name
              return (
                <div key={cell.idx} style={{
                  position: 'absolute', left: x + '%', top: y + '%', transform: 'translate(-50%,-50%)',
                  width: cellPct + '%', height: cellPct + '%', borderRadius: 6, boxSizing: 'border-box',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 1, overflow: 'hidden',
                  fontSize: fs, fontWeight: 800, lineHeight: 1.02, textAlign: 'center', wordBreak: 'break-all',
                  background: isLit ? 'linear-gradient(#fff6bf,#ffcf1a)' : isName ? 'rgba(255,255,255,.93)' : 'rgba(255,255,255,.10)',
                  color: isLit ? '#a5122b' : isName ? '#14283c' : '#ffd79f',
                  border: isLit ? '2px solid #fff' : '1px solid rgba(255,255,255,.22)',
                  boxShadow: isLit ? '0 0 16px 5px rgba(255,205,5,.95)' : 'none',
                  transition: 'background .05s, box-shadow .05s, color .05s',
                }}>{isName ? shortName(cell.name) : cell.fruit}</div>
              )
            })}
            {/* 中央顯示 */}
            <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', width: '60%', textAlign: 'center', pointerEvents: 'none' }}>
              <Mascot mood={reveal ? 'win' : spinning ? 'spin' : 'idle'} size={reveal ? 74 : 84} key={reveal ? 'w:' + reveal.name : spinning ? 'spin' : 'idle'} />
              {reveal ? (
                <div className="ws-win" key={reveal.name} style={{ marginTop: 2 }}>
                  <div style={{ fontSize: 10, letterSpacing: 3, color: '#ffcf3a', fontWeight: 800 }}>🎉 中 獎</div>
                  <div style={{ fontSize: 21, fontWeight: 900, color: '#fff', margin: '2px 0', textShadow: '0 2px 10px rgba(0,0,0,.6)', wordBreak: 'break-all' }}>{reveal.name}</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#ffd79f' }}>{reveal.caption}</div>
                </div>
              ) : (
                <div style={{ marginTop: 2, animation: spinning ? 'wsTitlePulse .5s ease-in-out infinite' : 'none' }}>
                  <div style={{ fontSize: 14, fontWeight: 900, color: '#ffcf3a', letterSpacing: 1, textShadow: '0 0 10px rgba(255,207,58,.6)' }}>{spinning ? '抽選中…' : '幸運小瑪莉'}</div>
                  {!spinning && <div style={{ fontSize: 10, color: '#9fb4cf', marginTop: 2 }}>{names.length < 1 ? '請先輸入名單' : credits < 1 ? '投幣後開始' : '按開始抽選'}</div>}
                </div>
              )}
            </div>
          </div>
          {/* 投幣區 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              {/* 投幣口 */}
              <div style={{ width: 54, height: 16, borderRadius: 4, background: 'linear-gradient(#2a2f3a,#12151c)', border: '2px solid #454b58', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ width: 30, height: 5, borderRadius: 3, background: '#000', boxShadow: 'inset 0 1px 3px rgba(0,0,0,.9)' }} />
              </div>
              {/* 硬幣 */}
              <div className={'ws-coin' + (coinAnim ? ' drop' : '')} onClick={insertCoin} title="投幣"
                style={{ width: 42, height: 42, borderRadius: '50%', background: 'radial-gradient(circle at 35% 30%,#ffe98a,#f5b301 55%,#b9820a)', border: '3px solid #d99a06', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 16, color: '#7a5300', boxShadow: '0 4px 8px rgba(0,0,0,.28)' }}>投</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700 }}>👆 投幣</div>
            </div>
          </div>
        </div>
      </div>

      <button onClick={spin} disabled={!canSpin} style={{
        marginTop: 16, padding: '13px 46px', borderRadius: 14, border: 'none', fontSize: 18, fontWeight: 900,
        background: canSpin ? 'linear-gradient(135deg,#c01f2f,#8a1220)' : 'var(--bg-secondary)',
        color: canSpin ? '#fff' : 'var(--text-muted)', cursor: canSpin ? 'pointer' : 'default',
        boxShadow: canSpin ? '0 6px 0 #5a0c16' : 'none', transition: 'transform .1s',
      }}>{spinning ? '🎰 抽選中…' : credits < 1 ? '🪙 先投幣' : '🎰 開始！'}</button>
    </div>
  )
}

function Led({ label, value, amber }) {
  return (
    <div style={{ background: '#141414', borderRadius: 6, padding: '3px 12px', textAlign: 'center', border: '1px solid #2e2e2e', minWidth: 62 }}>
      <div style={{ fontSize: 8, letterSpacing: 1, color: '#7a7a7a', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 900, fontFamily: 'ui-monospace,monospace', color: amber ? '#ffb300' : '#ff4444', textShadow: `0 0 8px ${amber ? '#ffb300' : '#ff4444'}` }}>{String(value).padStart(3, '0')}</div>
    </div>
  )
}

// 原創吉祥物「招財金幣小福星」(非任天堂版權角色)— 呼應投幣主題;會晃動/興奮/歡呼
function Mascot({ mood, size = 86 }) {
  const anim = mood === 'idle' ? 'wsBob 2.4s ease-in-out infinite'
    : mood === 'spin' ? 'wsCheer .35s ease-in-out infinite'
    : 'wsMwin .6s ease'
  const eyes = mood === 'win'
    ? (<>
        <path d="M35 53 q4.5 -6 9 0" fill="none" stroke="#5a3d00" strokeWidth="2.6" strokeLinecap="round" />
        <path d="M56 53 q4.5 -6 9 0" fill="none" stroke="#5a3d00" strokeWidth="2.6" strokeLinecap="round" />
      </>)
    : (<>
        <circle cx="41" cy="53" r="5.6" fill="#fff" stroke="#5a3d00" strokeWidth="1.4" />
        <circle cx="59" cy="53" r="5.6" fill="#fff" stroke="#5a3d00" strokeWidth="1.4" />
        <circle cx="42" cy={mood === 'spin' ? 51 : 54} r="2.7" fill="#3a2600" />
        <circle cx="60" cy={mood === 'spin' ? 51 : 54} r="2.7" fill="#3a2600" />
      </>)
  const mouth = mood === 'win'
    ? <path d="M40 62 q10 12 20 0 q-10 5 -20 0z" fill="#a5322a" />
    : mood === 'spin'
      ? <ellipse cx="50" cy="66" rx="5" ry="6.5" fill="#a5322a" />
      : <path d="M42 64 q8 7 16 0" fill="none" stroke="#7a2b12" strokeWidth="2.6" strokeLinecap="round" />
  return (
    <div style={{ width: size, height: size, margin: '0 auto', animation: anim, transformOrigin: '50% 82%' }}>
      <svg viewBox="0 0 100 100" width={size} height={size} style={{ display: 'block', filter: 'drop-shadow(0 4px 6px rgba(0,0,0,.4))' }}>
        <defs>
          <radialGradient id="wsCoinG" cx="38%" cy="32%" r="75%">
            <stop offset="0%" stopColor="#fff2b0" />
            <stop offset="55%" stopColor="#f7c331" />
            <stop offset="100%" stopColor="#d18f06" />
          </radialGradient>
        </defs>
        <ellipse cx="38" cy="91" rx="7" ry="4" fill="#c8860a" />
        <ellipse cx="62" cy="91" rx="7" ry="4" fill="#c8860a" />
        <ellipse cx="14" cy="58" rx="7" ry="5" fill="#eeb424" transform="rotate(-20 14 58)" />
        <ellipse cx="86" cy="52" rx="7" ry="5" fill="#eeb424" transform="rotate(24 86 52)" />
        <circle cx="50" cy="52" r="36" fill="#d99a06" />
        <circle cx="50" cy="52" r="31" fill="url(#wsCoinG)" stroke="#e8b83a" strokeWidth="1.5" />
        <path d="M50 27 l2.5 5.2 5.7.6 -4.3 3.8 1.3 5.6 -5.2-2.9 -5.2 2.9 1.3-5.6 -4.3-3.8 5.7-.6z" fill="#ff9d2e" />
        <circle cx="34" cy="61" r="4.5" fill="#ff8f8f" opacity=".7" />
        <circle cx="66" cy="61" r="4.5" fill="#ff8f8f" opacity=".7" />
        {eyes}
        {mouth}
      </svg>
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
    // 中心紅圈
    const rr = 34; ctx.save(); ctx.translate(R, R)
    ctx.beginPath(); ctx.arc(0, 0, rr, 0, 2 * Math.PI); ctx.fillStyle = '#c01f2f'; ctx.fill()
    ctx.beginPath(); ctx.arc(0, 0, rr, 0, 2 * Math.PI); ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.stroke()
    ctx.fillStyle = '#fff'; ctx.font = 'bold 18px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('抽', 0, 1)
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
