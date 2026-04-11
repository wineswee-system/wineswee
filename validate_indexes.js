import fs from 'fs';

const schemaContent = fs.readFileSync('C:/Users/user/.gemini/antigravity/brain/76ec0d6e-494a-41cc-8dfd-35425bdcc07e/.system_generated/steps/44/output.txt', 'utf-8');
const schema = JSON.parse(schemaContent);
const tables = {};
schema.tables.forEach(t => {
  const tName = t.name.replace('public.', '');
  tables[tName] = t.columns.map(c => c.name);
});

const sqlFile = fs.readFileSync('c:/Users/user/.gemini/antigravity/scratch/sme-ops-system/supabase/migrations/20260410_enterprise_indexes_rls.sql', 'utf-8');

const regex = /CREATE INDEX.*ON (\w+)\(([^)]+)\)/g;
let match;
while ((match = regex.exec(sqlFile)) !== null) {
  const tableName = match[1];
  const columns = match[2].split(',').map(c => c.trim().split(' ')[0]); // Handle DESC etc.
  
  if (!tables[tableName] && tableName !== 'event_outbox') { // event_outbox is created in this script
    console.log(`Table ${tableName} does not exist for index ${match[0]}`);
  } else if (tables[tableName]) {
    for (const col of columns) {
      if (!tables[tableName].includes(col)) {
         console.log(`Column ${col} does not exist in table ${tableName} for index ${match[0]}`);
      }
    }
  }
}
