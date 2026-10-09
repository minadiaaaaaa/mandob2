import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { errorHandler } from './http.js';

test('Malformed and oversized JSON receive client errors without exposing parser details', async () => {
  const app=express();app.use(express.json({limit:'1kb'}));app.post('/',(_req,res)=>res.json({ok:true}));app.use(errorHandler);
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  const address=server.address();assert.ok(address&&typeof address!=='string');const url=`http://127.0.0.1:${address.port}`;
  try {
    for(const [body,status,error] of [['{broken',400,'invalid_json'],[JSON.stringify({data:'x'.repeat(2048)}),413,'request_too_large']] as const){
      const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body});
      assert.equal(response.status,status);assert.deepEqual(await response.json(),{error});
    }
    assert.equal((await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,200);
    const unsupportedHeaders:Record<string,string>[]=[{'content-type':'application/json; charset=iso-8859-1'},{'content-type':'application/json','content-encoding':'unsupported'}];
    for(const headers of unsupportedHeaders){
      const response=await fetch(url,{method:'POST',headers,body:'{}'});
      assert.equal(response.status,415);assert.deepEqual(await response.json(),{error:'unsupported_encoding'});
    }
  } finally {await new Promise<void>((resolve,reject)=>server.close(err=>err?reject(err):resolve()));}
});
