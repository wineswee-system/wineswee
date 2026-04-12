import fs from 'fs';

const schemaContent = fs.readFileSync('C:/Users/user/.gemini/antigravity/brain/76ec0d6e-494a-41cc-8dfd-35425bdcc07e/.system_generated/steps/44/output.txt', 'utf-8');
const schema = JSON.parse(schemaContent);
const tables = {};
schema.tables.forEach(t => {
  const tName = t.name.replace('public.', '');
  tables[tName] = true;
});

const sqlFile = fs.readFileSync('c:/Users/user/.gemini/antigravity/scratch/sme-ops-system/supabase/migrations/20260410_enterprise_indexes_rls.sql', 'utf-8');

const regex = /ALTER TABLE (\w+) ENABLE ROW LEVEL SECURITY;/g;
let match;
while ((match = regex.exec(sqlFile)) !== null) {
  const tableName = match[1];
  if (!tables[tableName] && tableName !== 'event_outbox') {
    console.log(`Table ${tableName} does not exist for RLS Alter`);
  }
}
