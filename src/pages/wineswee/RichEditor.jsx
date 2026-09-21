import { useEffect, useRef } from 'react'
import Quill from 'quill'
import 'quill/dist/quill.snow.css'

const TOOLBAR = [
  [{ header: [1, 2, 3, false] }, { size: ['small', false, 'large', 'huge'] }],
  ['bold', 'italic', 'underline', 'strike'],
  [{ color: [] }, { background: [] }],
  [{ align: [] }],
  [{ list: 'ordered' }, { list: 'bullet' }],
  ['blockquote', 'link', 'image', 'video'],
  ['clean'],
]

// 圖文編輯器(Quill)：插圖走 Supabase Storage(非 base64),輸出 HTML
// 另加「點圖調大小」小工具列(小/中/大/滿版 + 靠左/置中/靠右),Quill 預設沒有。
export default function RichEditor({ value, onChange, upload }) {
  const wrapRef = useRef(null)
  const elRef = useRef(null)
  const qRef = useRef(null)
  const cbRef = useRef(onChange)
  cbRef.current = onChange

  useEffect(() => {
    if (qRef.current || !elRef.current) return
    const q = new Quill(elRef.current, {
      theme: 'snow',
      placeholder: '在這裡打字、排版、插入圖片…',
      modules: {
        toolbar: {
          container: TOOLBAR,
          handlers: {
            image: () => {
              const input = document.createElement('input')
              input.type = 'file'; input.accept = 'image/*'
              input.onchange = async () => {
                const f = input.files?.[0]; if (!f) return
                const url = await upload(f)
                if (url) {
                  const range = q.getSelection(true)
                  q.insertEmbed(range.index, 'image', url, 'user')
                  q.setSelection(range.index + 1)
                }
              }
              input.click()
            },
          },
        },
      },
    })
    qRef.current = q
    if (value) q.clipboard.dangerouslyPasteHTML(value)
    const fire = () => {
      const html = q.root.innerHTML
      cbRef.current(html === '<p><br></p>' ? '' : html)
    }
    q.on('text-change', fire)

    // ── 點圖 → 浮出大小/對齊小列 ───────────────────────────────
    let curImg = null
    const bar = document.createElement('div')
    bar.className = 'wa-imgbar'
    bar.style.display = 'none'
    const mkBtn = (label, fn) => {
      const b = document.createElement('button')
      b.type = 'button'; b.textContent = label
      b.addEventListener('mousedown', e => e.preventDefault())   // 別讓圖失焦
      b.addEventListener('click', () => { if (curImg) { fn(curImg); place(curImg); fire() } })
      bar.appendChild(b)
    }
    const setW = w => img => { img.style.width = w; img.style.height = 'auto' }
    const setAlign = a => img => {
      const p = img.closest('p') || img.parentElement
      if (p) p.style.textAlign = a
      // 靠左/右時圖不要撐滿一整行
      img.style.display = a === 'center' ? 'inline' : 'inline-block'
    }
    mkBtn('小', setW('25%')); mkBtn('中', setW('50%')); mkBtn('大', setW('75%')); mkBtn('滿版', setW('100%'))
    const sep = document.createElement('span'); sep.className = 'wa-imgbar-sep'; bar.appendChild(sep)
    mkBtn('靠左', setAlign('left')); mkBtn('置中', setAlign('center')); mkBtn('靠右', setAlign('right'))
    wrapRef.current.appendChild(bar)

    const place = img => {
      const wr = wrapRef.current.getBoundingClientRect()
      const r = img.getBoundingClientRect()
      bar.style.display = 'flex'
      bar.style.left = Math.max(4, r.left - wr.left) + 'px'
      bar.style.top = Math.max(2, r.top - wr.top - 38) + 'px'
    }
    const onClick = e => {
      if (e.target && e.target.tagName === 'IMG' && q.root.contains(e.target)) { curImg = e.target; place(e.target) }
      else { bar.style.display = 'none'; curImg = null }
    }
    q.root.addEventListener('click', onClick)
    const hide = () => { bar.style.display = 'none'; curImg = null }
    q.root.addEventListener('scroll', hide)

    return () => { q.root.removeEventListener('click', onClick); q.root.removeEventListener('scroll', hide); bar.remove() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div className="wa-rich" ref={wrapRef}><div ref={elRef} /></div>
}
