import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Shuffle, ArrowDownAZ, Trash2, Hash, Volume2, VolumeX, Sparkles, X, RotateCw } from 'lucide-react'

// 幸運轉盤（抽選）— 純前端工具，名單存 localStorage，不上傳。
// 轉盤色票走 canvas，依 CLAUDE.md 例外可用固定色值（canvas 無法解析 var(...)）。
const PALETTE = ['#0ea5e9', '#f97316', '#22c55e', '#a855f7', '#ef4444', '#eab308', '#14b8a6', '#ec4899', '#3b82f6', '#84cc16', '#f43f5e', '#06b6d4']
const LS_KEY = 'wheel_spinner_names'
const DEFAULT = '小明\n小華\n小美\n阿強\n阿珍\n大雄\n阿賢\n小芳'

export default function WheelSpinner() {
  const navigate = useNavigate()
  const [text, setText] = useState(() => localStorage.getItem(LS_KEY) || DEFAULT)
  const [removeWinner, setRemoveWinner] = useState(true)
  const [soundOn, setSoundOn] = useState(true)
  const [confettiOn, setConfettiOn] = useState(true)
  const [spinning, setSpinning] = useState(false)
  const [winner, setWinner] = useState(null)

  const canvasRef = useRef(null)
  const confettiRef = useRef(null)
  const rotRef = useRef(0)
  const rafRef = useRef(null)
  const acRef = useRef(null)

  const names = useMemo(() => text.split('\n').map(s => s.trim()).filter(Boolean), [text])

  useEffect(() => { localStorage.setItem(LS_KEY, text) }, [text])
  useEffect(() => () => cancelAnimationFrame(rafRef.current), [])

  // ── 畫轉盤 ──
  const draw = useCallback(() => {
    const cv = canvasRef.current; if (!cv) return
    const ctx = cv.getContext('2d')
    const size = cv.width, R = size / 2
    ctx.clearRect(0, 0, size, size)
    ctx.save(); ctx.translate(R, R); ctx.rotate(rotRef.current)
    const N = names.length
    if (N === 0) {
      ctx.beginPath(); ctx.arc(0, 0, R - 8, 0, 2 * Math.PI); ctx.fillStyle = '#e2e8f0'; ctx.fill()
      ctx.restore()
      ctx.fillStyle = '#94a3b8'; ctx.font = 'bold 18px sans-serif'; ctx.textAlign = 'center'
      ctx.fillText('請先輸入名單', R, R + 6); return
    }
    const seg = (2 * Math.PI) / N
    for (let i = 0; i < N; i++) {
      const a0 = i * seg
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R - 8, a0, a0 + seg); ctx.closePath()
      ctx.fillStyle = PALETTE[i % PALETTE.length]; ctx.fill()
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2; ctx.stroke()
      ctx.save(); ctx.rotate(a0 + seg / 2)
      ctx.textAlign = 'right'; ctx.fillStyle = '#ffffff'; ctx.font = `bold ${N > 18 ? 12 : 15}px -apple-system,"PingFang TC",sans-serif`
      const label = names[i].length > 11 ? names[i].slice(0, 10) + '…' : names[i]
      ctx.fillText(label, R - 20, 5); ctx.restore()
    }
    ctx.restore()
    // 中心軸
    ctx.beginPath(); ctx.arc(R, R, 30, 0, 2 * Math.PI); ctx.fillStyle = '#ffffff'; ctx.fill()
    ctx.strokeStyle = '#14283c'; ctx.lineWidth = 3; ctx.stroke()
  }, [names])

  useEffect(() => { draw() }, [draw])

  const tick = () => {
    if (!soundOn) return
    try {
      const AC = window.AudioContext || window.webkitAudioContext
      const ac = acRef.current || (acRef.current = new AC())
      const o = ac.createOscillator(), g = ac.createGain()
      o.type = 'square'; o.frequency.value = 760; g.gain.value = 0.04
      o.connect(g); g.connect(ac.destination); o.start(); o.stop(ac.currentTime + 0.02)
    } catch { /* noop */ }
  }

  const spin = () => {
    if (spinning || names.length < 2) return
    setSpinning(true); setWinner(null)
    const N = names.length, seg = (2 * Math.PI) / N
    const start = rotRef.current
    const target = start + (6 + Math.random() * 3) * 2 * Math.PI + Math.random() * 2 * Math.PI
    const dur = 4200 + Math.random() * 900, t0 = performance.now()
    let lastSeg = -1
    const ease = t => 1 - Math.pow(1 - t, 3)
    const frame = (now) => {
      const t = Math.min(1, (now - t0) / dur)
      rotRef.current = start + (target - start) * ease(t)
      const cur = Math.floor((rotRef.current % (2 * Math.PI)) / seg)
      if (cur !== lastSeg) { lastSeg = cur; tick() }
      draw()
      if (t < 1) rafRef.current = requestAnimationFrame(frame)
      else finish()
    }
    rafRef.current = requestAnimationFrame(frame)
  }

  const finish = () => {
    const N = names.length, seg = (2 * Math.PI) / N
    // 指針在正上方（canvas 角度 3π/2）；某段旋轉後落在指針 = 中獎
    const local = (((3 * Math.PI / 2 - rotRef.current) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
    const idx = Math.floor(local / seg) % N
    setSpinning(false)
    setWinner(names[idx])
    if (confettiOn) burstConfetti()
  }

  // ── 彩帶 ──
  const burstConfetti = () => {
    const cv = confettiRef.current; if (!cv) return
    const ctx = cv.getContext('2d')
    const W = cv.width = cv.offsetWidth, H = cv.height = cv.offsetHeight
    const parts = Array.from({ length: 140 }, () => ({
      x: W / 2, y: H * 0.35, vx: (Math.random() - 0.5) * 14, vy: Math.random() * -12 - 4,
      c: PALETTE[Math.floor(Math.random() * PALETTE.length)], s: 4 + Math.random() * 6, r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
    }))
    let frames = 0
    const step = () => {
      ctx.clearRect(0, 0, W, H); frames++
      parts.forEach(p => {
        p.vy += 0.35; p.x += p.vx; p.y += p.vy; p.r += p.vr
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c
        ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6); ctx.restore()
      })
      if (frames < 130) requestAnimationFrame(step); else ctx.clearRect(0, 0, W, H)
    }
    step()
  }

  const doRemoveWinner = () => {
    setText(prev => prev.split('\n').filter(l => l.trim() !== winner).join('\n'))
    setWinner(null)
  }
  const shuffle = () => setText(names.map(v => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map(x => x[1]).join('\n'))
  const sortAsc = () => setText([...names].sort((a, b) => a.localeCompare(b, 'zh-Hant')).join('\n'))
  const genRange = () => {
    const s = window.prompt('產生數字範圍(例如 1-100)', '1-30'); if (!s) return
    const m = s.match(/(\d+)\s*[-~到]\s*(\d+)/); if (!m) return
    let a = +m[1], b = +m[2]; if (a > b) [a, b] = [b, a]
    if (b - a > 500) { alert('範圍太大(上限 500)'); return }
    const arr = []; for (let i = a; i <= b; i++) arr.push(String(i))
    setText(arr.join('\n'))
  }

  return (
    <div className="fade-in" style={{ position: 'relative' }}>
      <div className="page-header"><div className="page-header-row">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="btn btn-secondary" onClick={() => navigate('/process/applications')} style={{ padding: '6px 10px' }}><ChevronLeft size={16} /></button>
          <div><h2><span className="header-icon">🎯</span> 幸運轉盤</h2><p>輸入名單 → 轉動抽選(隨機、公平、不上傳)</p></div>
        </div>
      </div></div>

      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {/* 轉盤 */}
        <div className="card" style={{ padding: 20, flex: '1 1 440px', minWidth: 320, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ position: 'relative', width: '100%', maxWidth: 460, aspectRatio: '1' }}>
            {/* 指針 */}
            <div style={{ position: 'absolute', top: -4, left: '50%', transform: 'translateX(-50%)', zIndex: 3, width: 0, height: 0, borderLeft: '16px solid transparent', borderRight: '16px solid transparent', borderTop: '30px solid var(--accent-red)', filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.3))' }} />
            <canvas ref={canvasRef} width={460} height={460} onClick={spin}
              style={{ width: '100%', height: '100%', borderRadius: '50%', cursor: spinning ? 'default' : 'pointer', boxShadow: '0 8px 30px rgba(0,0,0,.18)' }} />
          </div>
          <button onClick={spin} disabled={spinning || names.length < 2} style={{
            marginTop: 18, padding: '12px 40px', borderRadius: 12, border: 'none', fontSize: 17, fontWeight: 800,
            background: spinning || names.length < 2 ? 'var(--bg-secondary)' : 'linear-gradient(135deg,#0e7490,#0891b2)',
            color: spinning || names.length < 2 ? 'var(--text-muted)' : '#fff', cursor: spinning || names.length < 2 ? 'default' : 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 8,
          }}><RotateCw size={18} /> {spinning ? '轉動中…' : '開始抽選'}</button>
        </div>

        {/* 名單 + 設定 */}
        <div className="card" style={{ padding: 20, flex: '1 1 320px', minWidth: 300 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontWeight: 700 }}>名單 <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 13 }}>({names.length} 項)</span></div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-sm btn-secondary" title="產生數字" onClick={genRange}><Hash size={13} /></button>
              <button className="btn btn-sm btn-secondary" title="洗牌" onClick={shuffle}><Shuffle size={13} /></button>
              <button className="btn btn-sm btn-secondary" title="排序" onClick={sortAsc}><ArrowDownAZ size={13} /></button>
              <button className="btn btn-sm btn-secondary" title="清空" onClick={() => setText('')} style={{ color: 'var(--accent-red)' }}><Trash2 size={13} /></button>
            </div>
          </div>
          <textarea value={text} onChange={e => setText(e.target.value)} placeholder="一行一個名字…" spellCheck={false}
            style={{ width: '100%', height: 300, resize: 'vertical', padding: 12, borderRadius: 10, border: '1px solid var(--border-medium)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 14, lineHeight: 1.7, boxSizing: 'border-box', fontFamily: 'inherit' }} />

          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Toggle label="抽中後自動移除" on={removeWinner} set={setRemoveWinner} />
            <Toggle label="滴答音效" on={soundOn} set={setSoundOn} icon={soundOn ? <Volume2 size={14} /> : <VolumeX size={14} />} />
            <Toggle label="中獎彩帶" on={confettiOn} set={setConfettiOn} icon={<Sparkles size={14} />} />
          </div>
        </div>
      </div>

      {/* 彩帶層 */}
      <canvas ref={confettiRef} style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 9998 }} />

      {/* 中獎 */}
      {winner != null && (
        <div onClick={() => setWinner(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-card)', borderRadius: 18, padding: '32px 40px', textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,.4)', minWidth: 280, border: '1px solid var(--border-medium)' }}>
            <div style={{ fontSize: 13, letterSpacing: 4, color: 'var(--accent-cyan)', fontWeight: 700 }}>🎉 中 獎 者</div>
            <div style={{ fontSize: 34, fontWeight: 900, color: 'var(--text-primary)', margin: '10px 0 20px', wordBreak: 'break-all' }}>{winner}</div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              {removeWinner && <button className="btn btn-secondary" onClick={doRemoveWinner} style={{ color: 'var(--accent-red)' }}><Trash2 size={14} /> 移除並繼續</button>}
              <button className="btn btn-primary" onClick={() => { setWinner(null); setTimeout(spin, 50) }}><RotateCw size={14} /> 再抽一次</button>
              <button className="btn btn-secondary" onClick={() => setWinner(null)}><X size={14} /> 關閉</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Toggle({ label, on, set, icon }) {
  return (
    <button onClick={() => set(v => !v)} style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 12px', borderRadius: 10,
      border: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)', cursor: 'pointer', color: 'var(--text-primary)', fontSize: 14,
    }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{icon}{label}</span>
      <span style={{ width: 40, height: 22, borderRadius: 22, background: on ? 'var(--accent-cyan)' : 'var(--border-medium)', position: 'relative', transition: 'background .15s', flexShrink: 0 }}>
        <span style={{ position: 'absolute', top: 2, left: on ? 20 : 2, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
      </span>
    </button>
  )
}
