// 比對 migration 跑完後 DB vs chart，找出需補修的 row
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NEW_ORG, DEPT_NAME_TO_ID } from './_org_data.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const raw = readFileSync(join(ROOT, '.tmp_db_after_migration.json'), 'utf8')
const parsed = JSON.parse(raw.slice(raw.indexOf('{')))
// 容錯：rows 可能是 {row: {...}} 或直接 {...}
const dbEmployees = parsed.rows.map(r => r.row || r)
const dbById = new Map(dbEmployees.map(e => [e.id, e]))

const drifts = []

for (const p of NEW_ORG) {
  if (!p.keepId) continue
  const r = dbById.get(p.keepId)
  if (!r) {
    drifts.push({ id: p.keepId, type: 'MISSING', chart: p.zh, db: '<not found>' })
    continue
  }
  // name mismatch
  if (r.name !== p.zh) {
    drifts.push({ id: p.keepId, type: 'NAME', chart: p.zh, db: r.name })
  }
  // name_en mismatch
  const expectEn = p.en || null
  const actualEn = r.name_en || null
  if (expectEn !== actualEn) {
    drifts.push({ id: p.keepId, type: 'NAME_EN', chart: expectEn, db: actualEn })
  }
  // position 比對：只在管理職時嚴格要求一致
  const isManagement = ['部門主管', '督導', '區域店長', '店長'].includes(p.position)
  if (isManagement && r.position !== p.position) {
    drifts.push({ id: p.keepId, type: 'POSITION', chart: p.position, db: r.position, name: r.name })
  }
}

console.log('drift count:', drifts.length)
console.table(drifts)
