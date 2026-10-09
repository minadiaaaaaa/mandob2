import assert from 'node:assert/strict';import fs from 'node:fs';
const origin=process.argv[2]||'http://127.0.0.1:4100';assert.ok(/^http:\/\/(localhost|127\.0\.0\.1):(4100|4200)$/.test(origin));const results=[];
for(const [index,role] of ['Super Admin','Fleet Manager','Documents Officer','Data Entry','Viewer'].entries()){
let cookie='';async function call(method,path,body){const multipart=body instanceof FormData;const r=await fetch(origin+'/api'+path,{method,headers:{cookie,connection:'close',...(body!==undefined&&!multipart?{'content-type':'application/json'}:{})},body:body===undefined?undefined:multipart?body:JSON.stringify(body)});const sc=r.headers.get('set-cookie');if(sc)cookie=sc.split(';')[0];const data=await r.json();return {status:r.status,data}}
const ch=(await call('GET','/auth/challenge')).data;assert.equal((await call('POST','/auth/login',{username:'security.role.'+index,password:'RoleTest2026!',challengeId:ch.id,code:ch.code})).status,200);
const perms=new Set((await call('GET','/me')).data.perms);const id=8900100+index;
async function check(method,path,body,permission){const r=await call(method,path,body);const expected=perms.has(permission)?200:403;results.push({role,method,path,permission,expected,status:r.status,error:r.data.error});assert.equal(r.status,expected,JSON.stringify(results.at(-1)));return r.data}
await check('POST','/riders',{id:String(id),full_name:'QA '+role,status:'active'},'riders.create');
if(perms.has('riders.create')){await check('PATCH','/riders/'+id,{phone:'0551234567',alias:'QA updated'},'riders.update');const row=await check('GET','/riders/'+id,undefined,'riders.view');assert.equal(row.phone,'0551234567');}
await check('POST','/vehicles',{plate:'QA '+(8800+index),plate_en:'QA '+(8800+index),vehicle_type:'motorcycle',maker:'QA',year:2026},'vehicles.create');
await check('POST','/companies',{name:'QA Company '+index},'companies.create');
await check('POST','/performance',{rider_id:id,work_date:'2037-02-01',completed:18,notified:20,planned_hours:10,actual_hours:9,attendance_rate:0.9,acceptance_rate:0.9},'performance.create');
await check('POST','/advances',{rider_id:id,amount:100,installments:2},'advances.create');
const upload=new FormData();upload.append('entity_type','rider');upload.append('entity_id',String(id));upload.append('attachment_type','other');upload.append('file',new Blob(['%PDF-1.4\nQA fixture'],{type:'application/pdf'}),'qa.pdf');await check('POST','/attachments',upload,'attachments.upload');
console.log('Business writes checked:',role);
}
fs.writeFileSync('../database/supabase/role-workflow-verification.json',JSON.stringify({generatedAt:new Date().toISOString(),origin,total:results.length,results},null,2));console.log('ROLE WORKFLOWS PASSED:',results.length);
