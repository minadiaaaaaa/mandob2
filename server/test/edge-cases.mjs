import assert from 'node:assert/strict';import fs from 'node:fs';import {manual} from './route-inventory.mjs';
const origin=process.argv[2]||'http://127.0.0.1:4100';assert.ok(/^http:\/\/(localhost|127\.0\.0\.1):(4100|4200)$/.test(origin));const results=[];
function client(){let cookie='';return {get cookie(){return cookie},async call(method,path,body,extra={}){const r=await fetch(origin+'/api'+path,{method,headers:{cookie,connection:'close',...(body!==undefined?{'content-type':'application/json'}:{}),...extra},body:body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body)});const sc=r.headers.get('set-cookie');if(sc)cookie=sc.split(';')[0];let data;try{data=await r.json()}catch{}return {status:r.status,data}}}}
async function check(c,method,path,body,expected,extra){const r=await c.call(method,path,body,extra);results.push({method,path,status:r.status,expected,error:r.data?.error});assert.equal(r.status,expected,JSON.stringify(results.at(-1)));return r.data}
async function login(c,user,password){const ch=(await c.call('GET','/auth/challenge')).data;return check(c,'POST','/auth/login',{username:user,password,challengeId:ch.id,code:ch.code},200)}
const guest=client();const admin=client();const viewer=client();await login(admin,'admin','Admin12345!');await login(viewer,'security.role.4','RoleTest2026!');
await check(guest,'POST','/auth/login','{broken',400);await check(guest,'POST','/auth/login',{data:'x'.repeat(2100000)},413);
await check(guest,'GET','/me',undefined,401,{cookie:'lsp_sid=invalid-token'});
for(const route of manual.filter(r=>r.path.startsWith('/setup/')))await check(guest,route.method,route.path,route.method==='GET'?undefined:{},409);
for(const route of manual.filter(r=>r.path.startsWith('/portal/')&&!['/portal/login','/portal/logout','/portal/forgot','/portal/reset'].includes(r.path))){const p=route.path.replace(':id','999999');await check(guest,route.method,p,route.method==='GET'?undefined:{},401);await check(viewer,route.method,p,route.method==='GET'?undefined:{},401)}
await check(guest,'POST','/sync/ingest',{},401);await check(admin,'POST','/sync/ingest',{},401,{authorization:'Bearer wrong-token'});
await check(viewer,'PUT','/email/branding',{company_name:'Forbidden'},403);
const adminSessions=await check(admin,'GET','/profile/sessions',undefined,200);await check(viewer,'DELETE','/profile/sessions/'+adminSessions.find(s=>s.current).id,undefined,409);await check(admin,'GET','/me',undefined,200);
for(const query of ["search='+OR+1%3D1--",'sort=id%3BDROP+TABLE+riders','page=-1&pageSize=999999','search=%3Cscript%3Ealert(1)%3C%2Fscript%3E'])await check(admin,'GET','/riders?'+query,undefined,200);
const ratings=await check(admin,'GET','/ratings/rider/4000001',undefined,200);const regression=ratings.find(r=>r.month==='2037-01');assert.ok(regression);assert.equal(Number(regression.floor),0.85);assert.equal(Number(regression.next_floor),0.95);
const replayCookie=viewer.cookie;await check(viewer,'POST','/auth/logout',{},200);await check(guest,'GET','/me',undefined,401,{cookie:replayCookie});
fs.writeFileSync('../database/supabase/edge-verification.json',JSON.stringify({generatedAt:new Date().toISOString(),origin,total:results.length,results},null,2));console.log('EDGE AND REGRESSION CHECKS PASSED:',results.length);
