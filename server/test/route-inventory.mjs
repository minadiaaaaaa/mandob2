import fs from 'node:fs';
// Use caller CWD for portable test scripts invoked from server/.
const sources=['src/files.ts','src/scans.ts',...fs.readdirSync('src/routes').filter(f=>f.endsWith('.ts')).map(f=>'src/routes/'+f)];
const all=sources.map(file=>({file,text:fs.readFileSync(file,'utf8')}));
const imports=new Map();for(const {text} of all)for(const m of text.matchAll(/(?:const|let)\s+(\w+)[^=;]*=\s*\{\s*name:\s*'[^']+'\s*,\s*perm:\s*'([^']+)'/g))imports.set(m[1],m[2]);
const docs={id:'id_documents',license:'driving_licenses',health:'health_certs',driver_card:'driver_cards',ajeer:'ajeer_permits'};
export const routes=[];export const manual=[];
for(const {file,text} of all){
 const aliases=new Map([...text.matchAll(/(?:const|let)\s+(\w+)\s*=\s*can\(([^)]*)\)/g)].map(m=>[m[1],[...m[2].matchAll(/'([^']+)'/g)].map(x=>x[1])]));
 for(const m of text.matchAll(/(\w+Router)\.(get|post|patch|put|delete)\(\s*(['"])([^'"]+)\3\s*,/g)){
  const prefix=m[1]==='attachmentsRouter'?'/attachments':m[1]==='scansRouter'?'/scans':m[1]==='setupRouter'?'/setup':'';const route={file,line:text.slice(0,m.index).split('\n').length,method:m[2].toUpperCase(),path:prefix+m[4]};
  const tail=text.slice(m.index+m[0].length);const header=tail.slice(0,Math.min(...[tail.indexOf('async '),tail.indexOf('=>'),tail.indexOf(';')].filter(i=>i>=0),400));
  const direct=/can\(([^)]*)\)/.exec(header);let perms=direct?[...direct[1].matchAll(/'([^']+)'/g)].map(x=>x[1]):null;
  if(!perms)for(const [name,ps] of aliases)if(new RegExp('\\b'+name+'\\b').test(header)){perms=ps;break}
  const doc=/docGuard\('([^']+)'\)/.exec(header);
  if(doc){for(const [kind,module] of Object.entries(docs))routes.push({...route,path:route.path.replace(':type',kind),perms:[module+'.'+doc[1]]});continue}
  if(perms?.length)routes.push({...route,perms});else manual.push({...route,guard:header.trim().slice(0,90)});
 }
 for(const m of text.matchAll(/\w+Router\.use\('([^']+)',\s*importRoutes\((\w+|\{)/g)){
  const perm=m[2]==='{'?/perm:\s*'([^']+)'/.exec(text.slice(m.index,m.index+400))?.[1]:imports.get(m[2]);
  if(!perm)throw Error('Unresolved import permission: '+file+' '+m[1]);
  for(const [method,suffix] of [['GET','template'],['POST','preview'],['POST','run']])routes.push({file,method,path:m[1]+'/'+suffix,perms:[perm]});
 }
}
if(process.argv[1]?.endsWith('route-inventory.mjs'))console.log(JSON.stringify({guarded:routes.length,manual:manual.length,manualRoutes:manual},null,2));
