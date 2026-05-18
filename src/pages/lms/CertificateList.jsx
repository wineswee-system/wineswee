import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import { Award, Download, Calendar } from 'lucide-react'

export default function CertificateList() {
  const [certificates, setCertificates] = useState([])
  const [courseMap, setCourseMap] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('lms_certificates').select('*').order('issued_at', { ascending: false })
      .then(async ({ data: certs }) => {
        if (!certs?.length) { setLoading(false); return }
        setCertificates(certs)
        const courseIds = [...new Set(certs.map(c => c.course_id))]
        const { data: courses } = await supabase.from('lms_courses').select('id, title').in('id', courseIds)
        const cm = {}
        ;(courses || []).forEach(c => { cm[c.id] = c })
        setCourseMap(cm)
      }).finally(() => setLoading(false))
  }, [])

  if (loading) return <LoadingSpinner />

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: '0 0 4px', fontSize: 22, color: 'var(--text-primary)' }}>我的證書</h1>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>{certificates.length} 張結業證書</p>
      </div>

      {certificates.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 64, color: 'var(--text-muted)' }}>
          <Award size={44} style={{ marginBottom: 12, opacity: 0.3 }} />
          <p>尚未取得任何結業證書</p>
          <p style={{ fontSize: 13 }}>完成課程後即可獲得證書</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
          {certificates.map(cert => (
            <CertificateCard key={cert.id} cert={cert} course={courseMap[cert.course_id]} />
          ))}
        </div>
      )}
    </div>
  )
}

function CertificateCard({ cert, course }) {
  const issueDate = cert.issued_at ? new Date(cert.issued_at).toLocaleDateString('zh-TW') : '—'
  const expiryDate = cert.expires_at ? new Date(cert.expires_at).toLocaleDateString('zh-TW') : null
  const isExpired = cert.expires_at && new Date(cert.expires_at) < new Date()

  return (
    <div className="card" style={{ padding: '20px 22px', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4,
        background: 'linear-gradient(90deg, var(--accent-cyan), var(--accent-purple))' }} />

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 14 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--accent-green-dim)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Award size={22} style={{ color: 'var(--accent-green)' }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: '0 0 3px', fontSize: 15, color: 'var(--text-primary)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {course?.title || '—'}
          </h3>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
            證書編號：{cert.certificate_number}
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 20, fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <Calendar size={13} style={{ color: 'var(--text-muted)' }} />
          {issueDate}
        </span>
        {cert.score != null && (
          <span>得分：<strong style={{ color: 'var(--accent-green)' }}>{cert.score}</strong> 分</span>
        )}
      </div>

      {expiryDate && (
        <div style={{ fontSize: 12, marginBottom: 14,
          color: isExpired ? 'var(--accent-red)' : 'var(--text-muted)' }}>
          {isExpired ? '已過期：' : '有效期限：'}{expiryDate}
        </div>
      )}

      <button className="btn btn-secondary"
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 13 }}
        onClick={() => window.print()}>
        <Download size={13} /> 列印 / 下載
      </button>
    </div>
  )
}
