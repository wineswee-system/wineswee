import { useState, useCallback, useRef } from 'react'
import {
  Upload, Database, FileSpreadsheet, ShoppingCart, Users, Truck,
  Package, BookOpen, CheckCircle, AlertTriangle, XCircle, RefreshCw,
  Settings, Play, Eye, Download, Wifi, WifiOff, ChevronDown, ChevronUp,
} from 'lucide-react'
import {
  parseCSV, mapCSV, detectModule, validateRecords, detectDuplicates,
  FIELD_MAPS, WenzhongAPI,
} from '../../lib/wenzhong'
import {
  bulkUpsertSKUs, bulkUpsertCustomers, bulkUpsertSuppliers,
  bulkInsertPOSTransactions, bulkUpsertStockLevels, bulkInsertJournalEntries,
} from '../../lib/db'
import { supabase } from '../../lib/supabase'

// ── Module config ──────────────────────────────────────────

const MODULES = [
  { key: 'products',  icon: Package,        label: '商品 / SKU',   color: '#6366f1', dbFn: bulkUpsertSKUs,            dupKey: 'code' },
  { key: 'customers', icon: Users,           label: '客戶',         color: '#f59e0b', dbFn: bulkUpsertCustomers,       dupKey: 'code' },
  { key: 'suppliers', icon: Truck,           label: '供應商',       color: '#10b981', dbFn: bulkUpsertSuppliers,       dupKey: 'code' },
  { key: 'sales',     icon: ShoppingCart,    label: '銷售 / POS',   color: '#ef4444', dbFn: bulkInsertPOSTransactions, dupKey: 'receipt_no' },
  { key: 'inventory', icon: Database,        label: '庫存',         color: '#3b82f6', dbFn: bulkUpsertStockLevels,     dupKey: 'sku_code' },
  { key: 'journal',   icon: BookOpen,        label: '會計傳票',     color: '#8b5cf6', dbFn: bulkInsertJournalEntries,  dupKey: 'entry_no' },
]

// ── Main Component ─────────────────────────────────────────

export default function WenzhongImport() {
  // Tab: 'csv' or 'api'
  const [mode, setMode] = useState('csv')

  return (
    <div style={{ padding: 24 }}>
      <PageHeader />
      <ModeTabs mode={mode} setMode={setMode} />
      {mode === 'csv' ? <CSVImport /> : <APIImport />}
    </div>
  )
}

// ── Page Header ────────────────────────────────────────────

function PageHeader() {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 12,
          background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Upload size={22} color="#fff" />
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, color: 'var(--text-primary)' }}>
            文中資訊匯入
          </h1>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
            從文中系統匯入商品、客戶、銷售、庫存、供應商及會計資料
          </p>
        </div>
      </div>
    </div>
  )
}

// ── Mode Tabs ──────────────────────────────────────────────

function ModeTabs({ mode, setMode }) {
  const tabs = [
    { key: 'csv', icon: FileSpreadsheet, label: 'CSV 檔案匯入' },
    { key: 'api', icon: Wifi,            label: 'API 連線匯入' },
  ]
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
      {tabs.map(t => (
        <button key={t.key} onClick={() => setMode(t.key)} style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 20px', borderRadius: 10, border: 'none', cursor: 'pointer',
          fontSize: 14, fontWeight: 600,
          background: mode === t.key ? 'var(--primary, #6366f1)' : 'var(--bg-secondary)',
          color: mode === t.key ? '#fff' : 'var(--text-secondary)',
          transition: 'all .2s',
        }}>
          <t.icon size={16} />
          {t.label}
        </button>
      ))}
    </div>
  )
}

// ── CSV Import ─────────────────────────────────────────────

function CSVImport() {
  const [selectedModule, setSelectedModule] = useState(null)
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)   // { headers, rows, mapped, errors }
  const [importResult, setImportResult] = useState(null)
  const [importing, setImporting] = useState(false)
  const [duplicateMode, setDuplicateMode] = useState('skip') // 'skip' | 'overwrite'
  const [showErrors, setShowErrors] = useState(false)
  const fileRef = useRef()

  const handleFile = useCallback(async (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f)
    setImportResult(null)

    const text = await f.text()
    const { headers, rows } = parseCSV(text)

    if (rows.length === 0) {
      setPreview({ headers, rows: [], mapped: [], errors: [{ row: 0, warnings: ['CSV 檔案沒有資料列'] }] })
      return
    }

    // Auto-detect module if not selected
    let mod = selectedModule
    if (!mod) {
      mod = detectModule(headers)
      if (mod) setSelectedModule(mod)
    }

    if (!mod) {
      setPreview({ headers, rows, mapped: [], errors: [{ row: 0, warnings: ['無法自動辨識資料類型，請手動選擇'] }] })
      return
    }

    const { records, errors } = mapCSV(rows, mod)
    const { valid, invalid } = validateRecords(records, mod)
    const allErrors = [
      ...errors,
      ...invalid.map(inv => ({ row: inv.row, warnings: [`缺少必填欄位: ${inv.missing.join(', ')}`] })),
    ]
    setPreview({ headers, rows, mapped: valid, errors: allErrors })
  }, [selectedModule])

  const handleModuleChange = useCallback((key) => {
    setSelectedModule(key)
    setPreview(null)
    setImportResult(null)
    if (fileRef.current) fileRef.current.value = ''
    setFile(null)
  }, [])

  const handleImport = useCallback(async () => {
    if (!preview?.mapped?.length || !selectedModule) return
    setImporting(true)
    setImportResult(null)

    try {
      const mod = MODULES.find(m => m.key === selectedModule)
      let toImport = preview.mapped

      // Duplicate detection
      if (mod.dupKey && duplicateMode === 'skip') {
        const table = FIELD_MAPS[selectedModule].table
        const { data: existing } = await supabase.from(table).select(mod.dupKey)
        if (existing) {
          const { newRecords } = detectDuplicates(toImport, existing, mod.dupKey)
          const skipped = toImport.length - newRecords.length
          toImport = newRecords
          if (skipped > 0 && toImport.length === 0) {
            setImportResult({ ok: true, count: 0, skipped, message: `全部 ${skipped} 筆為重複資料，已略過` })
            setImporting(false)
            return
          }
        }
      }

      if (toImport.length === 0) {
        setImportResult({ ok: true, count: 0, message: '沒有可匯入的資料' })
        setImporting(false)
        return
      }

      // Batch in chunks of 500
      const BATCH = 500
      let total = 0
      for (let i = 0; i < toImport.length; i += BATCH) {
        const chunk = toImport.slice(i, i + BATCH)
        const { error } = await mod.dbFn(chunk)
        if (error) throw error
        total += chunk.length
      }

      setImportResult({
        ok: true,
        count: total,
        skipped: preview.mapped.length - toImport.length,
        message: `成功匯入 ${total} 筆${preview.mapped.length - toImport.length > 0 ? `，略過 ${preview.mapped.length - toImport.length} 筆重複` : ''}`,
      })
    } catch (err) {
      setImportResult({ ok: false, message: `匯入失敗: ${err.message}` })
    } finally {
      setImporting(false)
    }
  }, [preview, selectedModule, duplicateMode])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Module selector */}
      <Card title="1. 選擇資料類型">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
          {MODULES.map(m => (
            <button key={m.key} onClick={() => handleModuleChange(m.key)} style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
              padding: '14px 10px', borderRadius: 12, cursor: 'pointer',
              border: selectedModule === m.key ? `2px solid ${m.color}` : '2px solid var(--border-color)',
              background: selectedModule === m.key ? `${m.color}11` : 'var(--bg-primary)',
              transition: 'all .2s',
            }}>
              <m.icon size={24} color={m.color} />
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{m.label}</span>
            </button>
          ))}
        </div>
      </Card>

      {/* File upload */}
      <Card title="2. 上傳 CSV 檔案">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <label style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px',
            borderRadius: 10, cursor: 'pointer', fontSize: 14, fontWeight: 600,
            background: 'var(--primary, #6366f1)', color: '#fff',
          }}>
            <FileSpreadsheet size={16} />
            選擇檔案
            <input ref={fileRef} type="file" accept=".csv,.txt" onChange={handleFile}
              style={{ display: 'none' }} />
          </label>
          {file && <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{file.name} ({(file.size / 1024).toFixed(1)} KB)</span>}
          {selectedModule && (
            <span style={{
              fontSize: 12, padding: '4px 10px', borderRadius: 6,
              background: `${MODULES.find(m => m.key === selectedModule)?.color}22`,
              color: MODULES.find(m => m.key === selectedModule)?.color,
              fontWeight: 600,
            }}>
              {FIELD_MAPS[selectedModule].label}
            </span>
          )}
        </div>
        {/* Field mapping reference */}
        {selectedModule && (
          <FieldMapTable moduleKey={selectedModule} />
        )}
      </Card>

      {/* Preview */}
      {preview && (
        <Card title={`3. 預覽 (${preview.mapped.length} 筆有效資料)`}>
          {preview.errors.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <button onClick={() => setShowErrors(!showErrors)} style={{
                display: 'flex', alignItems: 'center', gap: 6, background: 'none',
                border: 'none', cursor: 'pointer', fontSize: 13, color: '#f59e0b', fontWeight: 600,
              }}>
                <AlertTriangle size={14} />
                {preview.errors.length} 筆警告
                {showErrors ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
              {showErrors && (
                <div style={{
                  marginTop: 8, padding: 12, borderRadius: 8, background: '#fef3c7',
                  fontSize: 12, maxHeight: 200, overflow: 'auto',
                }}>
                  {preview.errors.slice(0, 50).map((e, i) => (
                    <div key={i} style={{ marginBottom: 4, color: '#92400e' }}>
                      Row {e.row}: {e.warnings.join('; ')}
                    </div>
                  ))}
                  {preview.errors.length > 50 && (
                    <div style={{ color: '#92400e', fontWeight: 600 }}>...還有 {preview.errors.length - 50} 筆</div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Data preview table */}
          {preview.mapped.length > 0 && (
            <div style={{ overflow: 'auto', maxHeight: 320 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>
                    {Object.keys(preview.mapped[0]).map(k => (
                      <th key={k} style={{
                        textAlign: 'left', padding: '8px 10px', borderBottom: '2px solid var(--border-color)',
                        color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap',
                      }}>{k}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.mapped.slice(0, 20).map((row, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : 'var(--bg-secondary)' }}>
                      {Object.values(row).map((v, j) => (
                        <td key={j} style={{
                          padding: '6px 10px', borderBottom: '1px solid var(--border-color)',
                          color: 'var(--text-primary)', whiteSpace: 'nowrap', maxWidth: 200,
                          overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>{String(v ?? '')}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.mapped.length > 20 && (
                <div style={{ padding: 8, textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
                  ...顯示前 20 筆，共 {preview.mapped.length} 筆
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      {/* Import controls */}
      {preview?.mapped?.length > 0 && (
        <Card title="4. 匯入設定">
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-secondary)' }}>
              重複資料處理:
              <select value={duplicateMode} onChange={e => setDuplicateMode(e.target.value)} style={{
                padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border-color)',
                background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: 13,
              }}>
                <option value="skip">略過重複</option>
                <option value="overwrite">覆蓋更新</option>
              </select>
            </label>

            <button onClick={handleImport} disabled={importing} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '10px 24px',
              borderRadius: 10, border: 'none', cursor: importing ? 'not-allowed' : 'pointer',
              fontSize: 14, fontWeight: 700,
              background: importing ? 'var(--text-muted)' : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              color: '#fff', transition: 'all .2s',
            }}>
              {importing ? <RefreshCw size={16} className="spin" /> : <Play size={16} />}
              {importing ? '匯入中...' : `匯入 ${preview.mapped.length} 筆`}
            </button>
          </div>

          {/* Result */}
          {importResult && (
            <div style={{
              marginTop: 16, padding: 14, borderRadius: 10,
              display: 'flex', alignItems: 'center', gap: 10,
              background: importResult.ok ? '#ecfdf5' : '#fef2f2',
              border: `1px solid ${importResult.ok ? '#86efac' : '#fca5a5'}`,
            }}>
              {importResult.ok ? <CheckCircle size={18} color="#16a34a" /> : <XCircle size={18} color="#dc2626" />}
              <span style={{ fontSize: 14, fontWeight: 600, color: importResult.ok ? '#166534' : '#991b1b' }}>
                {importResult.message}
              </span>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}

// ── API Import ─────────────────────────────────────────────

function APIImport() {
  const [config, setConfig] = useState({ baseUrl: '', apiKey: '', companyId: '' })
  const [connected, setConnected] = useState(false)
  const [testing, setTesting] = useState(false)
  const [companyName, setCompanyName] = useState('')
  const [message, setMessage] = useState(null)
  const [syncing, setSyncing] = useState({})
  const [syncResults, setSyncResults] = useState({})

  const showMessage = (msg) => {
    setMessage(msg)
    setTimeout(() => setMessage(null), 6000)
  }

  const handleTest = async () => {
    if (!config.baseUrl || !config.apiKey) {
      showMessage({ ok: false, text: '請填寫 API 網址和金鑰' })
      return
    }
    setTesting(true)
    try {
      const api = new WenzhongAPI(config)
      const result = await api.testConnection()
      if (result.ok) {
        setConnected(true)
        setCompanyName(result.company)
        showMessage({ ok: true, text: `連線成功: ${result.company}` })
      } else {
        showMessage({ ok: false, text: `連線失敗: ${result.error}` })
      }
    } catch (err) {
      showMessage({ ok: false, text: `連線錯誤: ${err.message}` })
    } finally {
      setTesting(false)
    }
  }

  const handleSync = async (moduleKey) => {
    setSyncing(s => ({ ...s, [moduleKey]: true }))
    try {
      const api = new WenzhongAPI(config)
      const mod = MODULES.find(m => m.key === moduleKey)
      let records

      switch (moduleKey) {
        case 'products':  records = await api.fetchProducts(); break
        case 'customers': records = await api.fetchCustomers(); break
        case 'suppliers': records = await api.fetchSuppliers(); break
        case 'sales':     records = await api.fetchSales(); break
        case 'inventory': records = await api.fetchInventory(); break
        case 'journal':   records = await api.fetchJournalEntries(); break
        default: throw new Error('Unknown module')
      }

      if (!records?.length) {
        setSyncResults(s => ({ ...s, [moduleKey]: { ok: true, count: 0, text: '沒有資料' } }))
        return
      }

      const { valid } = validateRecords(records, moduleKey)
      if (valid.length === 0) {
        setSyncResults(s => ({ ...s, [moduleKey]: { ok: false, text: '資料驗證失敗' } }))
        return
      }

      const BATCH = 500
      let total = 0
      for (let i = 0; i < valid.length; i += BATCH) {
        const chunk = valid.slice(i, i + BATCH)
        const { error } = await mod.dbFn(chunk)
        if (error) throw error
        total += chunk.length
      }

      setSyncResults(s => ({ ...s, [moduleKey]: { ok: true, count: total, text: `同步 ${total} 筆` } }))
    } catch (err) {
      setSyncResults(s => ({ ...s, [moduleKey]: { ok: false, text: `失敗: ${err.message}` } }))
    } finally {
      setSyncing(s => ({ ...s, [moduleKey]: false }))
    }
  }

  const handleSyncAll = async () => {
    for (const mod of MODULES) {
      await handleSync(mod.key)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Connection config */}
      <Card title="API 連線設定">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
          <FieldInput label="API 網址" placeholder="https://api.wenzhong.com.tw/v1"
            value={config.baseUrl} onChange={v => setConfig(c => ({ ...c, baseUrl: v }))} />
          <FieldInput label="API 金鑰" placeholder="your-api-key" type="password"
            value={config.apiKey} onChange={v => setConfig(c => ({ ...c, apiKey: v }))} />
          <FieldInput label="公司代號" placeholder="company-id"
            value={config.companyId} onChange={v => setConfig(c => ({ ...c, companyId: v }))} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
          <button onClick={handleTest} disabled={testing} style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px',
            borderRadius: 10, border: 'none', cursor: testing ? 'not-allowed' : 'pointer',
            fontSize: 14, fontWeight: 600,
            background: testing ? 'var(--text-muted)' : 'var(--primary, #6366f1)', color: '#fff',
          }}>
            {testing ? <RefreshCw size={16} className="spin" /> : <Wifi size={16} />}
            {testing ? '測試中...' : '測試連線'}
          </button>
          {connected && (
            <span style={{
              display: 'flex', alignItems: 'center', gap: 6,
              fontSize: 13, color: '#16a34a', fontWeight: 600,
            }}>
              <CheckCircle size={14} /> 已連線: {companyName}
            </span>
          )}
        </div>

        {message && (
          <div style={{
            marginTop: 12, padding: 10, borderRadius: 8, fontSize: 13,
            background: message.ok ? '#ecfdf5' : '#fef2f2',
            color: message.ok ? '#166534' : '#991b1b',
          }}>
            {message.text}
          </div>
        )}
      </Card>

      {/* Sync modules */}
      {connected && (
        <Card title="資料同步">
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <button onClick={handleSyncAll} style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
              borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: '#fff',
            }}>
              <RefreshCw size={14} /> 全部同步
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
            {MODULES.map(m => (
              <div key={m.key} style={{
                padding: 16, borderRadius: 12, border: '1px solid var(--border-color)',
                background: 'var(--bg-primary)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <m.icon size={20} color={m.color} />
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{m.label}</span>
                </div>
                <button onClick={() => handleSync(m.key)} disabled={syncing[m.key]} style={{
                  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  gap: 6, padding: '8px 0', borderRadius: 8, border: '1px solid var(--border-color)',
                  cursor: syncing[m.key] ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 600,
                  background: syncing[m.key] ? 'var(--bg-secondary)' : 'var(--bg-primary)',
                  color: syncing[m.key] ? 'var(--text-muted)' : m.color,
                }}>
                  {syncing[m.key] ? <RefreshCw size={14} className="spin" /> : <Download size={14} />}
                  {syncing[m.key] ? '同步中...' : '同步'}
                </button>
                {syncResults[m.key] && (
                  <div style={{
                    marginTop: 8, fontSize: 12, fontWeight: 600, textAlign: 'center',
                    color: syncResults[m.key].ok ? '#16a34a' : '#dc2626',
                  }}>
                    {syncResults[m.key].text}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

// ── Shared UI Components ───────────────────────────────────

function Card({ title, children }) {
  return (
    <div style={{
      background: 'var(--bg-primary)', borderRadius: 14, padding: 20,
      border: '1px solid var(--border-color)',
    }}>
      {title && (
        <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
          {title}
        </h3>
      )}
      {children}
    </div>
  )
}

function FieldInput({ label, value, onChange, placeholder, type = 'text' }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>
        {label}
      </label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} style={{
          width: '100%', padding: '8px 12px', borderRadius: 8, fontSize: 13,
          border: '1px solid var(--border-color)', background: 'var(--bg-secondary)',
          color: 'var(--text-primary)', boxSizing: 'border-box',
        }} />
    </div>
  )
}

function FieldMapTable({ moduleKey }) {
  const mod = FIELD_MAPS[moduleKey]
  if (!mod) return null
  const [expanded, setExpanded] = useState(false)

  const entries = Object.entries(mod.fields)

  return (
    <div style={{ marginTop: 12 }}>
      <button onClick={() => setExpanded(!expanded)} style={{
        display: 'flex', alignItems: 'center', gap: 6, background: 'none',
        border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--text-muted)', fontWeight: 600,
      }}>
        <Eye size={13} />
        欄位對照表
        {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>
      {expanded && (
        <div style={{ marginTop: 8, overflow: 'auto', maxHeight: 260 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={thStyle}>文中欄位</th>
                <th style={thStyle}>系統欄位</th>
                <th style={thStyle}>必填</th>
                <th style={thStyle}>別名</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(([header, spec]) => {
                const aliases = Object.entries(mod.aliases || {})
                  .filter(([, can]) => can === header)
                  .map(([a]) => a)
                return (
                  <tr key={header}>
                    <td style={tdStyle}>{header}</td>
                    <td style={{ ...tdStyle, fontFamily: 'monospace', color: 'var(--primary, #6366f1)' }}>{spec.to}</td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      {spec.required && <span style={{ color: '#ef4444', fontWeight: 700 }}>*</span>}
                    </td>
                    <td style={{ ...tdStyle, color: 'var(--text-muted)' }}>{aliases.join(', ') || '-'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

const thStyle = {
  textAlign: 'left', padding: '6px 10px', borderBottom: '2px solid var(--border-color)',
  color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap',
}
const tdStyle = {
  padding: '5px 10px', borderBottom: '1px solid var(--border-color)',
  color: 'var(--text-primary)', whiteSpace: 'nowrap',
}
