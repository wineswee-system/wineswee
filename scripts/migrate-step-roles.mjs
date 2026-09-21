/**
 * One-time migration: normalize free-text step.role values in sop_templates
 * to match actual department names from the departments table.
 *
 * Run: node scripts/migrate-step-roles.mjs
 * Add --dry-run to preview changes without writing.
 */
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://mvkvnuxeamahhfahclmi.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12a3ZudXhlYW1haGhmYWhjbG1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1ODM3NDIsImV4cCI6MjA5MDE1OTc0Mn0.XdwpFEvels80p8A7u99hV-SChf_vu2jbb-28q8qJLoo'
)

const DRY_RUN = process.argv.includes('--dry-run')

// ── Alias → canonical department name ─────────────────────────────────────────
// Key: any free-text value that might appear in step.role
// Value: the department name as stored in the departments table
const ALIAS_MAP = {
  'HR': '人力資源部',
  'hr': '人力資源部',
  '人資': '人力資源部',
  '人資部': '人力資源部',
  '人力資源': '人力資源部',
  '工務': '工務部',
  '總務': '總務部',
  '管理部': '管理部',
  '財務': '財務部',
  '倉儲': '倉儲物流部',
  '物流': '倉儲物流部',
  '倉儲物流': '倉儲物流部',
  '採購': '採購部',
  '營運': '營運部',
  '行銷': '品牌行銷部',
  '品牌行銷': '品牌行銷部',
  '展店': '加盟展店事業部',
  '加盟展店': '加盟展店事業部',
  '展店事業部': '加盟展店事業部',
  '總經理室': '總經理室',
  '督導': '營運部',
}

async function main() {
  // Fetch actual department names to validate alias targets
  const { data: departments, error: deptErr } = await supabase
    .from('departments').select('id, name').order('name')
  if (deptErr) { console.error('Failed to fetch departments:', deptErr.message); process.exit(1) }

  const deptNames = new Set(departments.map(d => d.name))
  console.log(`Departments (${departments.length}):`, [...deptNames].join(', '))

  // Warn about alias targets that don't exist in the DB
  for (const [alias, target] of Object.entries(ALIAS_MAP)) {
    if (!deptNames.has(target)) {
      console.warn(`  ⚠ alias "${alias}" → "${target}" — not found in departments table, will be skipped`)
    }
  }

  // Build effective alias map (only targets that exist in DB)
  const effectiveMap = Object.fromEntries(
    Object.entries(ALIAS_MAP).filter(([, target]) => deptNames.has(target))
  )

  // Fetch all templates with steps
  const { data: templates, error: tplErr } = await supabase
    .from('sop_templates').select('id, name, steps')
  if (tplErr) { console.error('Failed to fetch templates:', tplErr.message); process.exit(1) }

  console.log(`\nTemplates to scan: ${templates.length}`)
  let totalUpdated = 0

  for (const tpl of templates) {
    if (!Array.isArray(tpl.steps) || tpl.steps.length === 0) continue

    let changed = false
    const newSteps = tpl.steps.map(step => {
      const raw = step.role?.trim() || ''
      if (!raw) return step

      // Already matches a real department — nothing to do
      if (deptNames.has(raw)) return step

      // Try alias map
      const mapped = effectiveMap[raw]
      if (mapped) {
        console.log(`  [${tpl.name}] step "${step.title}": "${raw}" → "${mapped}"`)
        changed = true
        return { ...step, role: mapped }
      }

      // No match — leave as-is (will appear as fallback option in dropdown)
      console.log(`  [${tpl.name}] step "${step.title}": "${raw}" — no mapping, kept`)
      return step
    })

    if (!changed) continue
    totalUpdated++

    if (DRY_RUN) {
      console.log(`  → DRY RUN: would update template id=${tpl.id}`)
      continue
    }

    const { error: updateErr } = await supabase
      .from('sop_templates').update({ steps: newSteps }).eq('id', tpl.id)
    if (updateErr) {
      console.error(`  ✗ Failed to update template id=${tpl.id}:`, updateErr.message)
    } else {
      console.log(`  ✓ Updated template id=${tpl.id} "${tpl.name}"`)
    }
  }

  console.log(`\nDone. ${totalUpdated} template(s) ${DRY_RUN ? 'would be' : 'were'} updated.`)
}

main()
