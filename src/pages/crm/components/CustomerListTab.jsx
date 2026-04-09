import { Plus, Search, ChevronDown, ChevronRight, Phone, Mail, Building2, Clock, Star } from 'lucide-react'
import MaskedText from '../../../components/MaskedText'

const CONTACT_TYPE_LABELS = { call: '📞 電話', email: '📧 Email', line: '💬 LINE', meeting: '🤝 面談' }
const PAGE_SIZE = 10

export default function CustomerListTab({
  filtered, locations, locFilter, setLocFilter,
  tagFilter, setTagFilter, TAGS, search, setSearch,
  expanded, toggleExpand, contacts, activityPages,
  loadMoreActivities, outboundOrders, companyLinks, companies,
  getLeadScore, getScoreColor, setActiveCustomerId, setShowContactModal,
  filterBtnStyle,
}) {
  return (
    <>
      {/* 分店篩選 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, marginTop: 16, flexWrap: 'wrap' }}>
        <button style={filterBtnStyle(locFilter === '')} onClick={() => setLocFilter('')}>全部分店</button>
        {locations.map(l => (
          <button key={l.id} style={filterBtnStyle(locFilter === String(l.id))} onClick={() => setLocFilter(String(l.id))}>{l.name}</button>
        ))}
      </div>

      {/* 標籤篩選 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <button style={filterBtnStyle(tagFilter === '')} onClick={() => setTagFilter('')}>全部標籤</button>
        {TAGS.map(tag => (
          <button key={tag} style={filterBtnStyle(tagFilter === tag)} onClick={() => setTagFilter(tag)}>{tag}</button>
        ))}
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">👥</span> 客戶清單 ({filtered.length})</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div className="search-bar"><Search className="search-icon" /><input type="text" placeholder="姓名/公司/電話..." className="form-input" style={{ paddingLeft: 38 }} value={search} onChange={e => setSearch(e.target.value)} /></div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {filtered.length === 0 && <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>尚無客戶資料</div>}
          {filtered.map(c => {
            const { score } = getLeadScore(c)
            return (
              <div key={c.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <div style={{ padding: '12px 16px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} onClick={() => toggleExpand(c.id)}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {expanded === c.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--accent-cyan)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 14, flexShrink: 0, position: 'relative' }}>
                      {c.name?.[0]}
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                        {c.name} {c.company && <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 400 }}>· {c.company}</span>}
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 3,
                          padding: '1px 8px', borderRadius: 10,
                          background: `${getScoreColor(score)}18`,
                          color: getScoreColor(score),
                          fontSize: 11, fontWeight: 700,
                        }}>
                          <Star size={10} fill="currentColor" /> {score}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', gap: 12 }}>
                        {c.phone && <span><Phone size={11} style={{ marginRight: 3 }} /><MaskedText value={c.phone} type="phone" canReveal={true} /></span>}
                        {c.email && <span><Mail size={11} style={{ marginRight: 3 }} /><MaskedText value={c.email} type="email" canReveal={true} /></span>}
                        {c.location_id && <span>📍 {locations.find(l => l.id === c.location_id)?.name}</span>}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {(c.tags || []).map(tag => (
                      <span key={tag} style={{ padding: '2px 8px', borderRadius: 6, background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)', fontSize: 11, fontWeight: 600 }}>{tag}</span>
                    ))}
                    <span className={`badge ${c.status === '活躍' ? 'badge-success' : c.status === '潛在' ? 'badge-info' : 'badge-neutral'}`}><span className="badge-dot"></span>{c.status}</span>
                    {c.credit_limit > 0 && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>額度 ${c.credit_limit.toLocaleString()}</span>}
                  </div>
                </div>

                {expanded === c.id && (
                  <CustomerExpandedDetail
                    customer={c}
                    contacts={contacts}
                    activityPages={activityPages}
                    loadMoreActivities={loadMoreActivities}
                    outboundOrders={outboundOrders}
                    companyLinks={companyLinks}
                    companies={companies}
                    getLeadScore={getLeadScore}
                    getScoreColor={getScoreColor}
                    setActiveCustomerId={setActiveCustomerId}
                    setShowContactModal={setShowContactModal}
                    locations={locations}
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}

function CustomerExpandedDetail({
  customer: c, contacts, activityPages, loadMoreActivities,
  outboundOrders, companyLinks, companies,
  getLeadScore, getScoreColor, setActiveCustomerId, setShowContactModal,
}) {
  const orders = outboundOrders.filter(o => o.customer === c.name).slice(0, 3)
  const link = companyLinks.find(l => l.contact_id === c.id)
  const comp = link ? companies.find(co => co.id === link.company_id) : null

  return (
    <div style={{ background: 'var(--glass-light)', padding: '12px 16px 16px', borderTop: '1px solid var(--border-subtle)' }}>
      {/* WMS 出貨狀態 */}
      {orders.length > 0 && (
        <div style={{ marginBottom: 14, padding: '10px 14px', borderRadius: 10, background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8 }}>🚚 最新出貨狀態（WMS）</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {orders.map(o => (
              <div key={o.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                <div>
                  <span style={{ fontWeight: 600 }}>{o.order_number}</span>
                  <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>{o.carrier}</span>
                  {o.tracking_number && <span style={{ color: 'var(--accent-cyan)', marginLeft: 8 }}>單號：{o.tracking_number}</span>}
                </div>
                <span className={`badge ${o.status === '已出貨' ? 'badge-success' : o.status === '揀貨中' || o.status === '已複核' ? 'badge-info' : 'badge-warning'}`}>
                  <span className="badge-dot"></span>{o.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Company Link Info */}
      {link && comp && (
        <div style={{ marginBottom: 14, padding: '10px 14px', borderRadius: 10, background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4 }}>
            <Building2 size={12} style={{ marginRight: 4, verticalAlign: -2 }} /> 所屬公司
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{comp.name}</span>
            <span style={{ marginLeft: 8 }}>角色：</span>
            <span style={{ padding: '1px 6px', borderRadius: 4, background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)', fontSize: 11, fontWeight: 600 }}>{link.role}</span>
            {comp.industry && <span style={{ marginLeft: 8 }}>產業：{comp.industry}</span>}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8 }}>📋 基本資料</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 2 }}>
            {c.source && <div>來源：{c.source}</div>}
            {c.assigned_to && <div>負責業務：{c.assigned_to}</div>}
            {c.notes && <div>備註：{c.notes}</div>}
            {c.outstanding_amount > 0 && <div style={{ color: 'var(--accent-orange)' }}>⚠ 未收帳款：${c.outstanding_amount?.toLocaleString()}</div>}
          </div>
          {/* Lead Score Breakdown */}
          {(() => {
            const { score, breakdown } = getLeadScore(c)
            return (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6 }}>
                  <Star size={12} style={{ marginRight: 4, verticalAlign: -2 }} /> 潛力分數：
                  <span style={{ color: getScoreColor(score), fontWeight: 700 }}>{score}</span>/100
                </div>
                <div style={{ width: '100%', height: 6, borderRadius: 3, background: 'var(--border-subtle)' }}>
                  <div style={{ width: `${score}%`, height: '100%', borderRadius: 3, background: getScoreColor(score), transition: 'width 0.3s ease' }} />
                </div>
                {breakdown.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                    {breakdown.map((b, i) => (
                      <span key={i} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'var(--glass-light)', color: 'var(--text-muted)' }}>
                        {b.label} +{b.points}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )
          })()}
        </div>

        {/* Full Activity Timeline */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>
              <Clock size={12} style={{ marginRight: 4, verticalAlign: -2 }} /> 互動時間軸
            </div>
            <button className="btn btn-secondary" style={{ fontSize: 11, padding: '3px 10px' }} onClick={e => { e.stopPropagation(); setActiveCustomerId(c.id); setShowContactModal(true) }}>
              <Plus size={11} /> 新增
            </button>
          </div>
          {(contacts[c.id] || []).length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>尚無互動紀錄</div>
          ) : (
            <div style={{ maxHeight: 320, overflowY: 'auto', paddingRight: 4 }}>
              {(contacts[c.id] || []).slice(0, activityPages[c.id] || PAGE_SIZE).map((ct, idx) => (
                <div key={ct.id} style={{ display: 'flex', gap: 10, position: 'relative', paddingBottom: 10 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                    <div style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: idx === 0 ? 'var(--accent-cyan)' : 'var(--border-medium)',
                      border: '2px solid var(--bg-card)',
                      flexShrink: 0, marginTop: 4,
                    }} />
                    {idx < (contacts[c.id] || []).slice(0, activityPages[c.id] || PAGE_SIZE).length - 1 && (
                      <div style={{ width: 2, flex: 1, background: 'var(--border-subtle)', minHeight: 16 }} />
                    )}
                  </div>
                  <div style={{ flex: 1, paddingBottom: 4 }}>
                    <div style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span>{CONTACT_TYPE_LABELS[ct.type] || '📋'}</span>
                      <span style={{ fontWeight: 600 }}>{ct.content}</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                      {ct.operator && <span>{ct.operator} · </span>}
                      {new Date(ct.created_at).toLocaleString('zh-TW')}
                    </div>
                  </div>
                </div>
              ))}
              {(contacts[c.id] || []).length > (activityPages[c.id] || PAGE_SIZE) && (
                <button
                  onClick={(e) => { e.stopPropagation(); loadMoreActivities(c.id) }}
                  style={{
                    width: '100%', padding: '6px 0', fontSize: 11,
                    color: 'var(--accent-cyan)', background: 'none',
                    border: '1px dashed var(--border-medium)', borderRadius: 6,
                    cursor: 'pointer', marginTop: 4,
                  }}
                >
                  載入更多（還有 {(contacts[c.id] || []).length - (activityPages[c.id] || PAGE_SIZE)} 筆）
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
