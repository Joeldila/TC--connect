import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startLocal} from '../scripts/local-start.mjs';
test('Local first-run setup, real HTTP login, offline operations and restart persistence',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tc-connect-local-'));let local=await startLocal({dataDir:dir,port:0});
 const password='Local-integration-password-624!';let cookie='';
 const req=async(path,body,status=200)=>{const headers={Origin:local.origin,...(cookie?{Cookie:cookie}:{})};if(body&&!(body instanceof FormData))headers['Content-Type']='application/json';const r=await fetch(local.origin+path,{method:body?'POST':'GET',headers,...(body?{body:body instanceof FormData?body:JSON.stringify(body)}:{})});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];const d=await r.json();assert.equal(r.status,status,JSON.stringify(d));return d};
 try{
  const setupResponse=await fetch(local.origin);assert.equal(setupResponse.headers.get('referrer-policy'),'same-origin','Native form submissions must retain same-origin identification');const page=await setupResponse.text();assert.ok(page.includes('Create administrator'));assert.ok(!page.includes('Local-integration-password'));
  const token=/name="setupToken" value="([a-f0-9]+)"/.exec(page)[1];
  let r=await fetch(local.origin+'/setup',{method:'POST',headers:{Origin:'https://unrelated.test','Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({setupToken:token,name:'Admin',email:'admin@example.test',password,confirm:password}),redirect:'manual'});assert.equal(r.status,403);
  r=await fetch(local.origin+'/setup',{method:'POST',headers:{Origin:local.origin,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({setupToken:'wrong',name:'Admin',email:'admin@example.test',password,confirm:password}),redirect:'manual'});assert.equal(r.status,403);
  r=await fetch(local.origin+'/setup',{method:'POST',headers:{Origin:local.origin,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({setupToken:token,name:'Local Administrator',email:'admin@example.test',password,confirm:password}),redirect:'manual'});assert.equal(r.status,303);assert.equal(r.headers.get('location'),'/');
  const health=await req('/health');assert.equal(health.localMode,true);assert.equal(health.meetingsConfigured,false);
  const publicState=await req('/api/centre');assert.equal(publicState.localMode,true);assert.equal(publicState.user,null);
  await req('/api/auth',{action:'login',email:'admin@example.test',password});let state=await req('/api/centre');assert.equal(state.user.must_change_password,0);assert.ok(!JSON.stringify(state).includes('scrypt$'));
  await req('/api/centre',{action:'year',name:'Year 2'});state=await req('/api/centre');const year=state.years[0];await req('/api/centre',{action:'group',yearId:year.id,name:'Group B'});state=await req('/api/centre');const group=state.groups[0];
  await req('/api/centre',{action:'module',code:'LOCAL201',name:'Local module',description:'Local test',yearId:year.id,groupId:group.id,lecturerId:state.user.id});state=await req('/api/centre');const module=state.modules[0];
  await req('/api/centre',{action:'message',room:'module:'+module.id,body:'Saved without a cloud connection.'});const messages=await req('/api/centre?room=module:'+module.id);assert.equal(messages[0].body,'Saved without a cloud connection.');
  await req('/api/centre',{action:'meeting',title:'Online lesson plan',description:'Can schedule while offline',moduleId:module.id,startAt:new Date(Date.now()+3600000).toISOString(),duration:60,capacity:20,mode:'lesson'});state=await req('/api/centre');await req('/api/centre',{action:'startMeeting',id:state.meetings[0].id},503);assert.equal((await req('/api/centre')).meetings[0].status,'Scheduled');
  // Startup is also tested with network APIs disabled: an existing offline workspace needs no network.
  await local.close();const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw new Error('Offline test: network unavailable')};try{local=await startLocal({dataDir:dir,port:0})}finally{globalThis.fetch=originalFetch}
  state=await req('/api/centre');assert.equal(state.modules[0].code,'LOCAL201');assert.equal(state.groups[0].name,'Group B');assert.equal((await req('/api/centre?room=module:'+module.id)).length,1);
  r=await fetch(local.origin+'/setup',{method:'POST',headers:{Origin:local.origin,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({setupToken:token,name:'Intruder',email:'other@example.test',password,confirm:password})});assert.equal(r.status,404);
  r=await fetch(local.origin+'/api/auth',{method:'POST',headers:{Origin:'https://evil.test','Content-Type':'application/json'},body:JSON.stringify({action:'logout'})});assert.equal(r.status,403);
  const html=await(await fetch(local.origin)).text();assert.ok(html.includes('/assets/'));assert.ok(!html.includes('Railway must be configured'));
  const assetPaths=[...html.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map(m=>m[1]);assert.ok(assetPaths.some(p=>p.endsWith('.js')));assert.ok(assetPaths.some(p=>p.endsWith('.css')));
  for(const asset of assetPaths){const assetResponse=await fetch(local.origin+asset);assert.equal(assetResponse.status,200,'The browser must be able to load '+asset);if(asset.endsWith('.js'))assert.ok(assetResponse.headers.get('content-type').includes('javascript'));if(asset.endsWith('.css'))assert.ok(assetResponse.headers.get('content-type').includes('text/css'));assert.ok((await assetResponse.arrayBuffer()).byteLength>0)}
  assert.equal((await fetch(local.origin+'/assets/missing.js')).status,404);

 }finally{await local.close();await rm(dir,{recursive:true,force:true})}
});

test('Setup accepts privacy-filtered same-origin forms only with browser metadata and the correct token',async()=>{
 for(const originHeader of ['null',null]){
  const dir=await mkdtemp(join(tmpdir(),'tc-connect-form-'));const local=await startLocal({dataDir:dir,port:0});
  const password='Local-form-test-password-564!';
  const page=await(await fetch(local.origin)).text(),token=/name="setupToken" value="([a-f0-9]+)"/.exec(page)[1];
  const form=(setupToken=token)=>new URLSearchParams({setupToken,name:'Test Administrator',email:'native@example.test',password,confirm:password});
  const send=(headers,body=form())=>fetch(local.origin+'/setup',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',...headers},body,redirect:'manual'});
  const privacy=originHeader?{Origin:originHeader}:{};
  try{
   assert.equal((await send({...privacy,'Sec-Fetch-Site':'cross-site'})).status,403,'A hidden origin alone cannot authorise setup');
   assert.equal((await send({...privacy})).status,403,'Missing browser provenance cannot authorise setup');
   assert.equal((await send({...privacy,'Sec-Fetch-Site':'same-origin'},form('incorrect'))).status,403,'Browser metadata does not replace the setup token');
   assert.equal((await send({Origin:'https://foreign.test','Sec-Fetch-Site':'same-origin'})).status,403,'An explicit foreign origin is rejected');
   assert.equal((await send({...privacy,'Sec-Fetch-Site':'same-origin'})).status,303,'Legitimate browser-local form can finish setup');
   const state=await(await fetch(local.origin+'/api/centre')).json();assert.equal(state.user,null);assert.equal(state.localMode,true);
  }finally{await local.close();await rm(dir,{recursive:true,force:true})}
 }
});
