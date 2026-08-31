import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Shuffle, ArrowDownAZ, Trash2, Hash, Volume2, VolumeX, Sparkles, X, RotateCw, History } from 'lucide-react'

// 幸運抽選遊戲機（轉盤 + 拉霸機／怪獸球風）— 純前端,名單/紀錄存 localStorage,不上傳。
// canvas / 球色用固定色值(CLAUDE.md 例外:JS 值餵 canvas 無法用 var())。
const PALETTE = ['#0ea5e9', '#f97316', '#22c55e', '#a855f7', '#ef4444', '#eab308', '#14b8a6', '#ec4899', '#3b82f6', '#84cc16', '#f43f5e', '#06b6d4']
const LS_KEY = 'wheel_spinner_names'
const LS_HIST = 'wheel_spinner_history'
const DEFAULT = '小明\n小華\n小美\n阿強\n阿珍\n大雄\n阿賢\n小芳'
const CAPTIONS = ['蛤～是你喔！', '登登登登～就是你！', '哇是你欸！', '恭喜，逃不掉了 🎉', '天選之人出現！', '球球選擇了你 ⚡', '中啦！快去謝老闆', '就決定是你了！', '啊不就好棒棒 ✨', '衝康成功(？)']

const CSS = `
@keyframes wsBallDrop{0%{transform:translateY(-360px) scale(1)}55%{transform:translateY(0) scale(1)}66%{transform:translateY(0) scaleX(1.35) scaleY(.62)}78%{transform:translateY(-46px) scaleX(.9) scaleY(1.12)}90%{transform:translateY(0) scaleX(1.12) scaleY(.9)}100%{transform:translateY(0) scale(1)}}
@keyframes wsWobble{0%,100%{transform:rotate(0)}12%{transform:rotate(-18deg)}30%{transform:rotate(15deg)}48%{transform:rotate(-12deg)}66%{transform:rotate(9deg)}84%{transform:rotate(-5deg)}}
@keyframes wsLever{0%{transform:rotate(0)}35%{transform:rotate(72deg)}100%{transform:rotate(0)}}
@keyframes wsShake{0%,100%{transform:translate(0,0)}20%{transform:translate(-3px,2px)}40%{transform:translate(3px,-2px)}60%{transform:translate(-2px,-2px)}80%{transform:translate(2px,2px)}}
@keyframes wsFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-14px)}}
@keyframes wsReadyPulse{0%,100%{box-shadow:0 0 0 0 rgba(255,203,5,.6),0 6px 14px rgba(0,0,0,.2)}50%{box-shadow:0 0 0 12px rgba(255,203,5,0),0 6px 14px rgba(0,0,0,.2)}}
@keyframes wsHint{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
@keyframes wsRays{0%{opacity:0;transform:translate(-50%,-50%) scale(.2) rotate(0)}25%{opacity:.9}100%{opacity:0;transform:translate(-50%,-50%) scale(2.7) rotate(160deg)}}
@keyframes wsRing{0%{opacity:.95;transform:translate(-50%,-50%) scale(.1)}100%{opacity:0;transform:translate(-50%,-50%) scale(3.2)}}
@keyframes wsFlash{0%{opacity:0}14%{opacity:.95}100%{opacity:0}}
@keyframes wsNamePop{0%{opacity:0;transform:translate(-50%,-50%) scale(0) rotate(-14deg)}55%{opacity:1;transform:translate(-50%,-50%) scale(1.3) rotate(6deg)}100%{opacity:1;transform:translate(-50%,-50%) scale(1) rotate(0)}}
.ws-ball{animation:wsBallDrop .72s cubic-bezier(.34,1.5,.5,1) both}
.ws-ball.wobble{animation:wsWobble 1.05s ease-in-out 1 both}
.ws-ball.ready{border-radius:50%;cursor:pointer;animation:wsReadyPulse 1.1s ease-out infinite}
.ws-ball .ws-top,.ws-ball .ws-bot{transition:transform .42s cubic-bezier(.34,1.8,.6,1)}
.ws-ball.open .ws-top{transform:translateY(-140%) rotate(-24deg)}
.ws-ball.open .ws-bot{transform:translateY(64%) rotate(12deg)}
.ws-ball .ws-name{opacity:0;transform:translate(-50%,-50%) scale(0)}
.ws-ball.open .ws-name{animation:wsNamePop .55s cubic-bezier(.34,1.9,.6,1) both}
.ws-rays,.ws-ring,.ws-flash{position:absolute;top:50%;left:50%;opacity:0;pointer-events:none}
.ws-ball.open .ws-rays{width:210px;height:210px;background:repeating-conic-gradient(from 0deg,rgba(255,230,109,.9) 0 6deg,transparent 6deg 15deg);border-radius:50%;animation:wsRays .75s ease-out both}
.ws-ball.open .ws-ring{width:66px;height:66px;border:5px solid #ffcb05;border-radius:50%;animation:wsRing .6s ease-out both}
.ws-ball.open .ws-flash{width:130px;height:130px;background:radial-gradient(rgba(255,255,255,.95),transparent 70%);border-radius:50%;animation:wsFlash .5s ease-out both}
.ws-hint{animation:wsHint .8s ease-in-out infinite}
`

// 怪獸球(風格化,非官方)— 純 CSS 畫;掉出→抖動→待點(發光)→點一下召喚爆開
function Ball({ size = 96, phase, name, caption, onOpen }) {
  const cls = 'ws-ball' + (phase === 'wobble' ? ' wobble' : '') + (phase === 'ready' ? ' ready' : '') + (phase === 'open' ? ' open' : '')
  const ring = Math.max(3, size * 0.05)
  const open = phase === 'open'
  return (
    <div style={{ position: 'relative', width: size, height: size + 22, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div className={cls} onClick={() => phase === 'ready' && onOpen && onOpen()} style={{ position: 'relative', width: size, height: size }}>
        {/* 召喚特效層 */}
        <div className="ws-rays" style={{ zIndex: 3 }} />
        <div className="ws-flash" style={{ zIndex: 3 }} />
        <div className="ws-ring" style={{ zIndex: 3 }} />
        <div className="ws-top" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '50%', background: 'linear-gradient(#ff5a5a,#ee1515)', borderRadius: `${size}px ${size}px 0 0`, boxSizing: 'border-box', border: `${ring}px solid #1a1a1a`, borderBottom: 'none', zIndex: 2 }} />
        <div className="ws-bot" style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '50%', background: 'linear-gradient(#ffffff,#e6e8ea)', borderRadius: `0 0 ${size}px ${size}px`, boxSizing: 'border-box', border: `${ring}px solid #1a1a1a`, borderTop: 'none', zIndex: 2 }} />
        {!open && <div style={{ position: 'absolute', top: `calc(50% - ${ring}px)`, left: 0, right: 0, height: ring * 2, background: '#1a1a1a', zIndex: 2 }} />}
        {!open && <div style={{ position: 'absolute', top: '50%', left: '50%', width: size * 0.3, height: size * 0.3, transform: 'translate(-50%,-50%)', borderRadius: '50%', background: phase === 'ready' ? '#ffcb05' : '#fff', border: `${ring}px solid #1a1a1a`, zIndex: 2, transition: 'background .2s' }} />}
        {/* 露出的中獎者 */}
        <div className="ws-name" style={{ position: 'absolute', top: '46%', left: '50%', minWidth: size * 1.3, textAlign: 'center', zIndex: 5 }}>
          <div style={{ fontSize: 20, fontWeight: 900, color: '#14283c', background: '#fff', borderRadius: 10, padding: '4px 12px', boxShadow: '0 4px 14px rgba(0,0,0,.25)', border: '2px solid #ffcb05', whiteSpace: 'nowrap' }}>{name}</div>
          <div style={{ fontSize: 11, color: '#ef4444', fontWeight: 700, marginTop: 4 }}>{caption}</div>
        </div>
      </div>
      {phase === 'ready' && <div className="ws-hint" style={{ marginTop: 4, fontSize: 11, fontWeight: 800, color: 'var(--accent-orange)' }}>👆 點我!</div>}
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
  const ding = () => { beep(880, 0.08, 'sine', 0.06); setTimeout(() => beep(1320, 0.12, 'sine', 0.06), 80) }

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
      {/* 背景飄球 */}
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 0, opacity: 0.5 }}>
        {[[80, '6%', '14%', 0], [54, '86%', '20%', 1.2], [110, '78%', '68%', 2], [46, '10%', '74%', 0.6], [66, '46%', '86%', 1.6]].map(([s, l, t, d], i) => (
          <div key={i} style={{ position: 'absolute', left: l, top: t, width: s, height: s, borderRadius: '50%', background: 'linear-gradient(#ff5a5a 0 50%, #eef0f2 50% 100%)', border: '2px solid rgba(0,0,0,.12)', animation: `wsFloat ${4 + i}s ease-in-out ${d}s infinite` }}>
            <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 3, transform: 'translateY(-50%)', background: 'rgba(0,0,0,.15)' }} />
            <div style={{ position: 'absolute', top: '50%', left: '50%', width: s * 0.28, height: s * 0.28, transform: 'translate(-50%,-50%)', borderRadius: '50%', background: '#fff', border: '2px solid rgba(0,0,0,.15)' }} />
          </div>
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
                <button className="btn btn-sm btn-secondary" title="產生數字" onClick={genRange}><Hash size={13} /></button>
                <button className="btn btn-sm btn-secondary" title="洗牌" onClick={shuffle}><Shuffle size={13} /></button>
                <button className="btn btn-sm btn-secondary" title="排序" onClick={sortAsc}><ArrowDownAZ size={13} /></button>
                <button className="btn btn-sm btn-secondary" title="清空" onClick={() => setText('')} style={{ color: 'var(--accent-red)' }}><Trash2 size={13} /></button>
              </div>
            </div>
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
    let delay = 55, elapsed = 0
    const cycle = () => {
      setReel(names[Math.floor(Math.random() * names.length)]); beep(600 + Math.random() * 300, 0.015)
      elapsed += delay; delay *= 1.13
      if (elapsed < 2100) T(cycle, delay); else drop(k)
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
      {/* 機台 */}
      <div style={{ position: 'relative', width: '100%', maxWidth: 420, animation: busy ? 'wsShake .3s linear infinite' : 'none' }}>
        <div style={{ borderRadius: 22, padding: '20px 20px 26px', background: 'linear-gradient(#ff5a5a,#d61414)', boxShadow: '0 10px 30px rgba(214,20,20,.35)', border: '4px solid #1a1a1a' }}>
          <div style={{ textAlign: 'center', color: '#fff', fontWeight: 900, letterSpacing: 3, fontSize: 15, marginBottom: 12, textShadow: '0 2px 0 rgba(0,0,0,.25)' }}>◉ 抽選機 ◉</div>
          {/* 顯示窗 */}
          <div style={{ background: '#0b1220', borderRadius: 14, padding: '26px 12px', textAlign: 'center', border: '4px solid #ffcb05', boxShadow: 'inset 0 4px 14px rgba(0,0,0,.6)' }}>
            <div style={{ fontSize: 34, fontWeight: 900, color: '#ffe66d', minHeight: 44, filter: busy ? 'blur(0.6px)' : 'none', letterSpacing: 1, wordBreak: 'break-all', textShadow: '0 0 12px rgba(255,203,5,.5)' }}>{reel}</div>
          </div>
          {/* 出球口 */}
          <div style={{ marginTop: 12, height: 8, background: '#1a1a1a', borderRadius: 4 }} />
        </div>
        {/* 拉桿 */}
        <div style={{ position: 'absolute', right: -20, top: 40, width: 16, height: 90, transformOrigin: 'top center', animation: lever ? 'wsLever .5s ease-in-out' : 'none' }}>
          <div style={{ width: 8, height: 66, margin: '0 auto', background: '#9ca3af', borderRadius: 4 }} />
          <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'radial-gradient(circle at 35% 30%,#ff8a8a,#d61414)', margin: '-4px auto 0', border: '3px solid #1a1a1a' }} />
        </div>
      </div>

      {/* 掉出的球 */}
      <div style={{ minHeight: 130, marginTop: 24, display: 'flex', gap: 14, flexWrap: 'wrap', justifyContent: 'center', alignItems: 'flex-start', width: '100%' }}>
        {balls.map(b => <Ball key={b.id} phase={b.phase} name={b.name} caption={b.caption} onOpen={() => openBall(b.id)} />)}
      </div>

      <button onClick={pull} disabled={busy || names.length < 1} style={{
        marginTop: 8, padding: '13px 44px', borderRadius: 14, border: 'none', fontSize: 18, fontWeight: 900,
        background: busy || names.length < 1 ? 'var(--bg-secondary)' : 'linear-gradient(135deg,#ffcb05,#ff9500)',
        color: busy || names.length < 1 ? 'var(--text-muted)' : '#1a1a1a', cursor: busy || names.length < 1 ? 'default' : 'pointer',
        boxShadow: busy ? 'none' : '0 6px 0 #b36b00', transition: 'transform .1s',
      }}>{busy ? '🎲 抽選中…' : '🕹️ 拉！丟球！'}</button>
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
