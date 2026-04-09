import { Search, AlertTriangle, Merge } from 'lucide-react'
import LoadingSpinner from '../../../components/LoadingSpinner'

export default function DuplicateMergeTab({ duplicates, dupScanning, runDuplicateDetection, handleMerge }) {
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-header">
        <div className="card-title"><AlertTriangle size={16} style={{ marginRight: 6 }} /> 查重合併</div>
        <button className="btn btn-primary" onClick={runDuplicateDetection} disabled={dupScanning}>
          <Search size={14} /> {dupScanning ? '掃描中...' : '執行查重'}
        </button>
      </div>
      {dupScanning ? (
        <LoadingSpinner message="正在掃描重複客戶..." />
      ) : duplicates.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>
          <AlertTriangle size={32} style={{ marginBottom: 8, opacity: 0.4 }} />
          <div>點擊「執行查重」掃描重複客戶</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>系統將比對電話、Email、姓名、公司來找出疑似重複的資料</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          <div style={{ padding: '10px 16px', fontSize: 12, color: 'var(--text-muted)', borderBottom: '1px solid var(--border-subtle)' }}>
            找到 {duplicates.length} 組疑似重複
          </div>
          {duplicates.map((dup, idx) => (
            <div key={idx} style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 16 }}>
              {/* Customer A */}
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{dup.customerA.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {dup.customerA.company && <span>{dup.customerA.company} · </span>}
                  {dup.customerA.phone && <span>{dup.customerA.phone} · </span>}
                  {dup.customerA.email}
                </div>
              </div>
              {/* Match score */}
              <div style={{ textAlign: 'center', flexShrink: 0 }}>
                <div style={{
                  width: 44, height: 44, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: dup.score >= 70 ? 'var(--accent-red)' : dup.score >= 50 ? 'var(--accent-orange)' : 'var(--accent-yellow)',
                  color: '#fff', fontWeight: 800, fontSize: 14,
                }}>
                  {dup.score}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
                  {dup.reasons.join('、')}
                </div>
              </div>
              {/* Customer B */}
              <div style={{ flex: 1, textAlign: 'right' }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{dup.customerB.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {dup.customerB.company && <span>{dup.customerB.company} · </span>}
                  {dup.customerB.phone && <span>{dup.customerB.phone} · </span>}
                  {dup.customerB.email}
                </div>
              </div>
              {/* Merge button */}
              <button className="btn btn-secondary" style={{ flexShrink: 0, fontSize: 11, padding: '5px 12px' }} onClick={() => handleMerge(dup)}>
                <Merge size={12} /> 合併
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
