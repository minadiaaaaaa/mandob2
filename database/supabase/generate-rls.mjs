import fs from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), '../..'));
for(const [p,kind] of [['server/src/auth.ts','staff'],['server/src/routes/portal.ts','rider']]) {let s=fs.readFileSync(p,'utf8'); s=s.replace(/sessionId: s.sid };\r?\n  next\(\);/,`sessionId: s.sid };\n  withActor({ kind: '${kind}', id: s.id }, next);`);fs.writeFileSync(p,s)}
const tables=JSON.parse(fs.readFileSync('database/supabase/manifest.json','utf8')).tables;
const staff="current_setting('app.actor_kind',true) = 'staff' AND NULLIF(current_setting('app.actor_id',true),'')::bigint > 0";
const id="NULLIF(current_setting('app.actor_id',true),'')::bigint";
const rider=e=>`(current_setting('app.actor_kind',true) = 'rider' AND (${e}))`;
let sql=`BEGIN;
DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='mandoob_request') THEN CREATE ROLE mandoob_request NOLOGIN NOBYPASSRLS; END IF; END $$;
ALTER ROLE mandoob_request NOLOGIN NOBYPASSRLS;
GRANT mandoob_request TO postgres;
GRANT USAGE ON SCHEMA public TO mandoob_request;
`;
const owned=new Set(['rider_documents','vehicle_assignments','leaves','rider_absences','advances','rider_change_requests','rider_issues','fines','wallet_snapshots','wallet_entries','billing','daily_performance','branding_photos','monthly_ratings','rider_accounts','rider_sessions','rider_codes','notifications']);
for(const {table:t} of tables){
 let own='false';
 if(owned.has(t))own=`rider_id = ${id}`;
 if(t==='riders')own=`id = ${id}`;
 if(['cities','languages','translation_overrides','rating_cutoffs'].includes(t))own='true';
 if(t==='companies')own=`EXISTS (SELECT 1 FROM public.riders r WHERE r.id = ${id} AND r.company_id = companies.id)`;
 if(t==='contracts')own=`EXISTS (SELECT 1 FROM public.riders r WHERE r.id = ${id} AND r.contract_id = contracts.id)`;
 if(t==='advance_installments')own=`EXISTS (SELECT 1 FROM public.advances a WHERE a.id = advance_installments.advance_id AND a.rider_id = ${id})`;
 if(t==='rider_issue_messages')own=`internal = 0 AND EXISTS (SELECT 1 FROM public.rider_issues i WHERE i.id = rider_issue_messages.issue_id AND i.rider_id = ${id})`;
 if(t==='attachments')own=`(entity_type='rider' AND entity_id = ${id}::text) OR (entity_type LIKE 'rider_doc_%' AND EXISTS (SELECT 1 FROM public.rider_documents d WHERE d.id::text=attachments.entity_id AND d.rider_id=${id})) OR (entity_type='change_request' AND EXISTS (SELECT 1 FROM public.rider_change_requests c WHERE c.id::text=attachments.entity_id AND c.rider_id=${id})) OR (entity_type='issue_message' AND EXISTS (SELECT 1 FROM public.rider_issue_messages m JOIN public.rider_issues i ON i.id=m.issue_id WHERE m.id::text=attachments.entity_id AND m.internal=0 AND i.rider_id=${id}))`;
 sql+=`GRANT SELECT, INSERT, UPDATE, DELETE ON public."${t}" TO mandoob_request;
ALTER TABLE public."${t}" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_staff ON public."${t}";
CREATE POLICY app_staff ON public."${t}" TO mandoob_request USING (${staff}) WITH CHECK (${staff});
DROP POLICY IF EXISTS app_rider_read ON public."${t}";
CREATE POLICY app_rider_read ON public."${t}" FOR SELECT TO mandoob_request USING (${rider(own)});
`;
 const actions = ({riders:['UPDATE'], rider_accounts:['INSERT','UPDATE'], rider_sessions:['UPDATE'], rider_codes:['INSERT','UPDATE'], rider_change_requests:['INSERT','UPDATE'], rider_issues:['INSERT','UPDATE'], rider_issue_messages:['INSERT'], attachments:['INSERT','UPDATE'], leaves:['INSERT','UPDATE']})[t] || [];
 sql+=`DROP POLICY IF EXISTS app_rider_write ON public."${t}";\n`;
 for(const action of ['INSERT','UPDATE','DELETE']) {
   const name='app_rider_'+action.toLowerCase();
   sql+=`DROP POLICY IF EXISTS ${name} ON public."${t}";\n`;
   if(actions.includes(action)) {
     const check=t==='rider_issue_messages' ? '('+own+") AND author = 'rider' AND user_id IS NULL" : own;
     sql+=`CREATE POLICY ${name} ON public."${t}" FOR ${action} TO mandoob_request ${action==='UPDATE'?'USING ('+rider(own)+') ':''}WITH CHECK (${rider(check)});\n`;
   }
 }

}
sql+=`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO mandoob_request;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon,authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon,authenticated;
COMMIT;\n`;
fs.writeFileSync('database/supabase/rls.sql',sql);
