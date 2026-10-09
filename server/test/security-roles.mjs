// Run against the disposable test server on port 4100/4200, never a production instance.
import assert from 'node:assert/strict';
const base=(process.argv[2]||'http://127.0.0.1:4100')+'/api';
function client(){let cookie='';return async(method,path,body)=>{const headers={cookie,connection:'close'};if(body!==undefined)headers['content-type']='application/json';const r=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});const sc=r.headers.get('set-cookie');if(sc)cookie=sc.split(';')[0];return {status:r.status,body:r.headers.get('content-type')?.includes('json')?await r.json():{bytes:(await r.arrayBuffer()).byteLength}}}}
async function login(c,user,password){const ch=(await c('GET','/auth/challenge')).body;assert.equal((await c('POST','/auth/login',{username:user,password,challengeId:ch.id,code:ch.code})).status,200)}
const admin=client();await login(admin,'admin','Admin12345!');const roles=(await admin('GET','/roles')).body.rows;
const existing=(await admin('GET','/users')).body.rows;
const names=['Super Admin','Fleet Manager','Documents Officer','Data Entry','Viewer'];
for(const [index,name] of names.entries()){
 const role=roles.find(r=>r.name===name);assert.ok(role,name);const username='security.role.'+index;const password='RoleTest2026!';
 if(!existing.some(u=>u.username===username)) assert.equal((await admin('POST','/users',{username,full_name:name+' Test',email:username+'@example.com',password,confirm:password,role_id:role.id})).status,200);
 const c=client();await login(c,username,password);assert.equal((await c('GET','/me')).body.role,name);
 assert.equal((await c('GET','/riders')).status,200,name+' operational read');
 assert.equal((await c('GET','/users')).status,name==='Super Admin'?200:403,name+' staff administration');
 assert.equal((await c('PATCH','/riders/4000001',{alias:'Role permission check'})).status,name==='Viewer'?403:200,name+' editing');
 assert.equal((await c('GET','/riders/export')).status,name==='Data Entry'?403:200,name+' export');
 if(name!=='Super Admin'){
  assert.equal((await c('DELETE','/riders/4000001')).status,403,name+' delete');
  assert.equal((await c('POST','/advances/999999/approve')).status,403,name+' advance approval');
  assert.equal((await c('GET','/roles')).status,403,name+' role management');
  assert.equal((await c('GET','/backups')).status,403,name+' backups');
 }
 console.log('ROLE CHECK PASSED:',name);
}
