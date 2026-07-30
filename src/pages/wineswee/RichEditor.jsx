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
export default function RichEditor({ value, onChange, upload }) {
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
    q.on('text-change', () => {
      const html = q.root.innerHTML
      cbRef.current(html === '<p><br></p>' ? '' : html)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div className="wa-rich"><div ref={elRef} /></div>
}
