#!/usr/bin/env node
// ============================================================================
// Storage 同步:舊 Supabase 專案 → 新專案(所有 bucket、遞迴、delta)
//   冷備份的 pg dump 只搬 DB,不含 Storage 檔案。這支補上。
//
// 用法:
//   1. 填好新專案的 service_role key（見下方 env）。
//   2. 首次全量:  node scripts/storage_sync.mjs
//   3. 切換當天 delta（只補新增/變更的檔）: 同一支再跑一次即可(預設 skip 已存在同大小的檔)。
//   4. 要強制覆蓋全部:  FORCE=1 node scripts/storage_sync.mjs
//
// env（可用 shell 或 .env.migrate）:
//   OLD_URL / OLD_KEY  預設讀 .env 的 VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
//   NEW_URL            預設 https://uoernfpfieurtjqwbnii.supabase.co（改成你的新 ref）
//   NEW_KEY            ★新專案 Settings → API → service_role key（必填）
//   ONLY_BUCKET        只同步某個 bucket（選填,如 leave-attachments）
// ============================================================================
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const envFile = (() => { try { return readFileSync(new URL('../.env', import.meta.url), 'utf8') } catch { return '' } })()
const fromEnvFile = (k) => (envFile.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim()

const OLD_URL = process.env.OLD_URL || fromEnvFile('VITE_SUPABASE_URL')
const OLD_KEY = process.env.OLD_KEY || fromEnvFile('SUPABASE_SERVICE_ROLE_KEY')
const NEW_URL = process.env.NEW_URL || 'https://uoernfpfieurtjqwbnii.supabase.co'
const NEW_KEY = process.env.NEW_KEY || ''
const ONLY_BUCKET = process.env.ONLY_BUCKET || ''
const FORCE = process.env.FORCE === '1'

if (!OLD_URL || !OLD_KEY) { console.error('✗ 缺舊專案 OLD_URL / OLD_KEY（.env）'); process.exit(1) }
if (!NEW_KEY) { console.error('✗ 缺新專案 NEW_KEY（service_role）— 設環境變數 NEW_KEY=...'); process.exit(1) }
if (NEW_URL === OLD_URL) { console.error('✗ 新舊 URL 相同,別搞錯'); process.exit(1) }

const old = createClient(OLD_URL, OLD_KEY, { auth: { persistSession: false } })
const neu = createClient(NEW_URL, NEW_KEY, { auth: { persistSession: false } })

// 遞迴列出一個 bucket 底下所有檔案（含子資料夾）
async function listAll(client, bucket, prefix = '') {
  const out = []
  let offset = 0
  const LIMIT = 100
  for (;;) {
    const { data, error } = await client.storage.from(bucket).list(prefix, { limit: LIMIT, offset, sortBy: { column: 'name', order: 'asc' } })
    if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`)
    if (!data || data.length === 0) break
    for (const item of data) {
      const path = prefix ? `${prefix}/${item.name}` : item.name
      if (item.id === null || item.metadata == null) {
        // 資料夾 → 遞迴
        out.push(...await listAll(client, bucket, path))
      } else {
        out.push({ path, size: item.metadata?.size ?? null })
      }
    }
    if (data.length < LIMIT) break
    offset += LIMIT
  }
  return out
}

async function ensureBucket(bucket, isPublic) {
  const { data } = await neu.storage.getBucket(bucket)
  if (data) return
  const { error } = await neu.storage.createBucket(bucket, { public: isPublic })
  if (error && !/already exists/i.test(error.message)) throw new Error(`createBucket ${bucket}: ${error.message}`)
  console.log(`  + 建 bucket ${bucket} (public=${isPublic})`)
}

async function main() {
  console.log(`Storage 同步  舊 ${OLD_URL}  →  新 ${NEW_URL}`)
  console.log(FORCE ? '  模式: FORCE 全覆蓋' : '  模式: delta（skip 已存在同大小）')

  const { data: buckets, error: bErr } = await old.storage.listBuckets()
  if (bErr) { console.error('✗ 列 bucket 失敗:', bErr.message); process.exit(1) }
  const targets = buckets.filter(b => !ONLY_BUCKET || b.name === ONLY_BUCKET)
  console.log(`  bucket 數: ${targets.length}${ONLY_BUCKET ? `（只同步 ${ONLY_BUCKET}）` : ''}\n`)

  let totCopied = 0, totSkipped = 0, totFailed = 0
  for (const b of targets) {
    await ensureBucket(b.name, b.public)
    const oldFiles = await listAll(old, b.name)
    // 新專案現有檔（delta 比對用）：path → size
    const newFiles = new Map((await listAll(neu, b.name)).map(f => [f.path, f.size]))
    let copied = 0, skipped = 0, failed = 0
    for (const f of oldFiles) {
      if (!FORCE && newFiles.has(f.path) && (f.size == null || newFiles.get(f.path) === f.size)) { skipped++; continue }
      const { data: blob, error: dErr } = await old.storage.from(b.name).download(f.path)
      if (dErr) { console.warn(`  ✗ 下載 ${b.name}/${f.path}: ${dErr.message}`); failed++; continue }
      const buf = Buffer.from(await blob.arrayBuffer())
      const { error: uErr } = await neu.storage.from(b.name).upload(f.path, buf, { upsert: true, contentType: blob.type || undefined })
      if (uErr) { console.warn(`  ✗ 上傳 ${b.name}/${f.path}: ${uErr.message}`); failed++; continue }
      copied++
      if (copied % 50 === 0) console.log(`    …${b.name}: 已複製 ${copied}`)
    }
    console.log(`  [${b.name}] 共 ${oldFiles.length} 檔 → 複製 ${copied}、略過 ${skipped}、失敗 ${failed}`)
    totCopied += copied; totSkipped += skipped; totFailed += failed
  }
  console.log(`\n完成:複製 ${totCopied}、略過 ${totSkipped}、失敗 ${totFailed}`)
  if (totFailed > 0) { console.log('⚠ 有失敗,重跑一次會補（delta）'); process.exit(2) }
}

main().catch(e => { console.error('✗ 失敗:', e.message); process.exit(1) })
