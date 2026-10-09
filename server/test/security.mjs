// Run against the disposable test server on port 4100/4200, never a production instance.
import assert from 'node:assert/strict';
const base=(process.argv[2]||'http://localhost:4200')+'/api';
assert.match(base, /^http:\/\/(?:localhost|127\.0\.0\.1):(4100|4200)\/api$/, 'Disposable test ports only');
function client(){let cookie='';return async(method,path,body)=>{const headers={cookie,connection:'close'};if(body!==undefined && !(body instanceof FormData))headers['content-type']='application/json';const r=await fetch(base+path,{method,headers,body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});const c=r.headers.get('set-cookie');if(c)cookie=c.split(';')[0];return {status:r.status,body:await r.json().catch(()=>({}))}}}
const admin=client(), limited=client(), guest=client();
async function login(c,user,password){const ch=(await c('GET','/auth/challenge')).body;assert.equal((await c('POST','/auth/login',{username:user,password,challengeId:ch.id,code:ch.code})).status,200)}
await login(admin,'admin','Admin12345!');await login(limited,'night.user','NightUser123');
for(const path of ['/riders','/users','/roles','/settings/organization','/backups','/email/log','/issues','/advances','/vehicles']){assert.equal((await limited('GET',path)).status,403,path);assert.equal((await guest('GET',path)).status,401,path)}
const form=new FormData();form.append('file',new Blob(['private'],{type:'application/pdf'}),'private.pdf');const scan=(await admin('POST','/scans',form)).body.token;assert.ok(scan);
for(const [method,path] of [['GET',`/scans/${scan}`],['POST',`/scans/${scan}/read`],['DELETE',`/scans/${scan}`]])assert.equal((await limited(method,path)).status,404,'scan owner');
assert.equal((await admin('GET',`/scans/${scan}`)).status,200);assert.equal((await admin('DELETE','/scans/..%2Foutside')).status,404);assert.equal((await admin('DELETE',`/scans/${scan}`)).status,200);
const role=(await admin('GET','/roles')).body.rows.find(r=>r.name==='Night Shift');const user=(await admin('GET','/users')).body.rows.find(u=>u.username==='night.user');
assert.equal((await admin('PUT',`/roles/${role.id}/permissions`,{perms:['riders.view']})).status,200);
assert.equal((await limited('GET','/riders')).status,200,'grant effective on existing session');
assert.equal((await limited('POST','/riders',{id:'8800001',full_name:'Forbidden'})).status,403);
assert.equal((await limited('GET','/users')).status,403);
assert.equal((await admin('PUT',`/roles/${role.id}/permissions`,{perms:[]})).status,200);
assert.equal((await limited('GET','/riders')).status,403,'revoke effective immediately');
assert.equal((await admin('POST',`/users/${user.id}/disable`)).status,200);
assert.equal((await limited('GET','/me')).status,401,'disabled session');
assert.equal((await admin('POST',`/users/${user.id}/activate`)).status,200);
await login(limited,'night.user','NightUser123');
assert.equal((await admin('POST',`/roles/${role.id}/disable`)).status,409,'active users prevent role disabling');
assert.equal((await limited('GET','/me')).status,200);
assert.equal((await admin('POST',`/roles/${role.id}/activate`)).status,200);
const second=process.argv.includes('--existing')?await admin('GET','/riders/8800002'):(await admin('POST','/riders',{id:'8800002',full_name:'Security Second Rider',status:'active'}));assert.equal(second.status,200);
assert.equal((await admin('POST','/riders/8800002/portal/reset-password',{password:'SecondRider2026',confirm:'SecondRider2026'})).status,200);
const rider=client();assert.equal((await rider('POST','/portal/login',{rider_id:'8800002',password:'SecondRider2026'})).status,200);
assert.equal((await rider('GET','/portal/me')).body.id,8800002);
const allIssues=(await admin('GET','/issues')).body.rows;const foreign=allIssues.find(i=>i.rider_id!==8800002);assert.ok(foreign);
assert.equal((await rider('GET',`/portal/issues/${foreign.id}`)).status,404);
assert.equal((await rider('POST',`/portal/issues/${foreign.id}/read`)).status,404);
assert.equal((await rider('GET','/riders')).status,401,'rider session is not staff');
if(process.argv.includes('--existing')) {
 const date=new Date(Date.now()+70*86400000).toISOString().slice(0,10);
 const leave=await rider('POST','/portal/leaves',{leave_type:'emergency',start_date:date,end_date:date,reason:'Second rider integration test'});
 assert.equal(leave.status,200,JSON.stringify(leave.body));
 assert.ok((await rider('GET','/portal/leaves')).body.rows.some(l=>l.id===leave.body.id));
}
console.log('SECURITY API CHECKS PASSED: guest, limited staff, grants/revocation, disabled user, scan ownership/traversal, cross-rider conversation');
