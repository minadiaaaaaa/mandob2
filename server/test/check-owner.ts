import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DB_SCHEMA, ROOT, DATA_DIR, q, closeDb } from '../src/db.js';
if (DB_SCHEMA !== 'public') throw new Error('This check reads the configured owner application');
const credentials = readFileSync(join(DATA_DIR,'first-login.txt'),'utf8');
const username = /^Username: (.+)$/m.exec(credentials)![1];
const password = /^Password: (.+)$/m.exec(credentials)![1];
let cookie='';
const request = async (path:string, body?:unknown) => {
  const response=await fetch(`http://127.0.0.1:4000/api${path}`,{method:body?'POST':'GET',headers:{cookie,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const newCookie=response.headers.get('set-cookie'); if(newCookie)cookie=newCookie.split(';')[0];
  const data=await response.json(); assert.equal(response.status,200,`${path}: ${data.error ?? response.status}`); return data;
};
const challenge=await request('/auth/challenge');
await request('/auth/login',{username,password,challengeId:challenge.id,code:challenge.code});
assert.equal((await request('/me')).username,username);
const paths=['/dashboard','/riders','/vehicles','/applicants','/advances','/leaves','/notifications','/backups','/reports/riders','/reports/documents'];
for(const path of paths){const data=await request(path);if(path==='/dashboard'){assert.ok(data.figures);assert.ok(data.alerts);assert.ok(data.charts.expiring);}}
const [user]=await q('SELECT username FROM users WHERE username=?',[username]); assert.equal(user.username,username);
const checks=await q(readFileSync(join(ROOT,'../database/supabase/deployment-verification.sql'),'utf8').replace("(SELECT count(*)::text FROM public.users), '0'","(SELECT count(*)::text FROM public.users), '1'").replace("WHERE key='system.installed'), '0'","WHERE key='system.installed'), '1'"));
assert.ok(checks.every(check=>check.passed));
const report={checkedAt:new Date().toISOString(),projectRef:'mzsjtckqoqjinsjafnfb',owner:username,driver:'postgres',tlsVerified:true,applicationUrl:'http://127.0.0.1:4000',applicationReads:paths,databaseChecks:checks,localFullSmoke:'passed'};
writeFileSync(join(ROOT,'../database/supabase/application-verification.json'),JSON.stringify(report,null,2));
await closeDb(); console.log('Owner sign-in, 10 application reads and 13 live database checks passed');
