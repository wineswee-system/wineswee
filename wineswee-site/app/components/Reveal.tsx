'use client'
import { useEffect, useRef, useState } from 'react'

export default function Reveal({
  children, className = '', as = 'div',
}: { children: React.ReactNode; className?: string; as?: 'div' | 'section' }) {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setShown(true); io.disconnect() } },
      { threshold: 0.1 }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const cls = `${className} reveal${shown ? ' in' : ''}`
  const Tag = as as any
  return <Tag ref={ref} className={cls}>{children}</Tag>
}
