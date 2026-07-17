import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
const sb = createClient('https://mvkvnuxeamahhfahclmi.supabase.co', process.env.SVC)
const r = await sb.rpc('_dump_function_defs',{p_names:['_push_off_request_flex']});
fs.writeFileSync('_fn_flex.sql',(r.data||[])[0]?.fn_def||'');
console.log('寫出,行 45-75:');
