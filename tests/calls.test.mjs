import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../server/index.mjs';
import {createSession} from '../server/security.mjs';
test('Private app extensions, targeted call notifications, signaling privacy and lifecycle',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tc-voice-'));const app=await createApplication({production:false,localMode:true,dataDir:dir,appUrl:'https://voice.test',adminEmail:'owner@voice.test',adminPassword:'Secure-owner-test-password-29!'});
 const sql=app.db.sql;const owner=sql.prepare('SELECT * FROM users LIMIT 1').get();sql.prepare('UPDATE users SET must_change_password=0 WHERE id=?').run(owner.id);sql.prepare('INSERT INTO years VALUES (?,?)').run('y2','Year 2');sql.prepare('INSERT INTO groups VALUES (?,?,?)').run('g2','Group B','y2');
 const add=(id,role,group,staff='[]')=>{sql.prepare("INSERT INTO users (id,email,name,role,status,group_id,staff_groups,student_no,created_at,password_hash) VALUES (?,?,?,?,'active',?,?,?,?,?)").run(id,id+'@voice.test',id+' Full Name',role,group,staff,role==='student'?'ST-'+id:null,new Date().toISOString(),owner.password_hash);return sql.prepare('SELECT * FROM users WHERE id=?').get(id)};
 const teacher=add('lecturer','lecturer',null,'["g2"]'),student=add('student','student','g2'),peer=add('peer','student','g2'),tech=add('technician','technician',null),admin=sql.prepare('SELECT * FROM users WHERE id=?').get(owner.id);
 const client=async u=>{const cookie=(await createSession(app.db,u,false)).split(';')[0];return {async raw(path='/api/calls',body){return app.handle(new Request('https://voice.test'+path,{method:body?'POST':'GET',headers:{Origin:'https://voice.test',Cookie:cookie,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}))},async get(path='/api/calls',status=200){const r=await this.raw(path);const d=await r.json();assert.equal(r.status,status,JSON.stringify(d));return d},async post(body,status=200){const r=await this.raw('/api/calls',body);const d=await r.json();assert.equal(r.status,status,JSON.stringify(d));return d}}};
 const a=await client(teacher),b=await client(student),other=await client(peer),manager=await client(admin),technician=await client(tech);const readers=[];
 try{
  assert.match(student.extension,/^\d{6,}$/);assert.notEqual(student.extension,teacher.extension);assert.equal(new Set(sql.prepare('SELECT extension FROM users').all().map(u=>u.extension)).size,5);
  const profile=await a.get('/api/calls?extension='+student.extension);assert.equal(profile.person.student_no,student.student_no);assert.equal(profile.person.year_name,'Year 2');assert.equal(profile.person.group_name,'Group B');await other.get('/api/calls?extension='+student.extension,403);
  for(const c of [a,b,other]){const r=await c.raw('/api/calls/events');assert.equal(r.status,200);const reader=r.body.getReader();readers.push(reader);await reader.read();await reader.read()}
  const started=await a.post({action:'dial',targetId:student.id});const id=started.call.id;assert.equal(started.call.status,'ringing');assert.equal(started.call.peer.student_no,'ST-student');
  for(const reader of readers.slice(0,2)){const r=await reader.read();assert.ok(new TextDecoder().decode(r.value).includes(id))}
  const third=await Promise.race([readers[2].read().then(()=>true),new Promise(r=>setTimeout(()=>r(false),50))]);assert.equal(third,false,'A third user gets no call notification');
  assert.equal((await b.get()).current.direction,'incoming');assert.equal((await other.get()).current,null);assert.equal((await manager.get()).history.length,0,'Admins do not get other users private call history');await manager.get('/api/calls?id='+id,403);await other.get('/api/calls?id='+id,403);
  await a.post({action:'accept',id},409);await other.post({action:'accept',id},403);await manager.post({action:'end',id},403);
  await manager.post({action:'dial',targetId:student.id},409);
  await a.post({action:'signal',id,kind:'offer',payload:{type:'offer',sdp:'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n'}});
  const recipient=await b.get('/api/calls?id='+id);assert.equal(recipient.signals[0].kind,'offer');assert.equal((await a.get('/api/calls?id='+id)).signals.length,0);
  await b.post({action:'signal',id,kind:'answer',payload:{type:'answer',sdp:'v=0\r\nm=audio 9 RTP/AVP 111'}},403);
  await b.post({action:'accept',id});await b.post({action:'signal',id,kind:'answer',payload:{type:'answer',sdp:'v=0\r\nm=audio 9 RTP/AVP 111'}});await b.post({action:'signal',id,kind:'ice',payload:{candidate:'candidate:test',sdpMid:'0',sdpMLineIndex:0}});
  const caller=await a.get('/api/calls?id='+id);assert.deepEqual(caller.signals.map(s=>s.kind),['answer','ice']);assert.equal((await a.get('/api/calls?id='+id+'&after='+caller.signals.at(-1).seq)).signals.length,0);
  await a.post({action:'connected',id});assert.equal((await a.get()).current.status,'connecting');await b.post({action:'connected',id});assert.equal((await a.get()).current.status,'active');
  await b.post({action:'end',id});assert.equal((await a.get('/api/calls?id='+id)).call.status,'ended');assert.equal((await b.get()).current,null);assert.equal(sql.prepare('SELECT COUNT(*) n FROM call_locks').get().n,0);
  const second=await a.post({action:'dial',extension:student.extension});await b.post({action:'decline',id:second.call.id});assert.equal((await a.get('/api/calls?id='+second.call.id)).call.status,'declined');
  const thirdCall=await a.post({action:'dial',targetId:student.id});sql.prepare('UPDATE voice_calls SET created_at=? WHERE id=?').run(new Date(Date.now()-46000).toISOString(),thirdCall.call.id);assert.equal((await a.get('/api/calls?id='+thirdCall.call.id)).call.status,'missed');
  await technician.post({action:'dial',targetId:student.id},403);
  const finalCall=await a.post({action:'dial',targetId:student.id});const logout=await b.raw('/api/auth',{action:'logout'});assert.equal(logout.status,200);assert.equal((await a.get('/api/calls?id='+finalCall.call.id)).call.status,'ended');
 }finally{for(const reader of readers)await reader.cancel();await app.close();await rm(dir,{recursive:true,force:true})}
});
test('Internet deployment requires a relay; temporary TURN credentials do not expose the shared secret',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tc-relay-'));const app=await createApplication({production:false,localMode:false,dataDir:dir,appUrl:'https://voice.test',adminEmail:'owner@voice.test',adminPassword:'Secure-owner-test-password-29!'});
 try{const owner=app.db.sql.prepare('SELECT * FROM users LIMIT 1').get();app.db.sql.prepare('UPDATE users SET must_change_password=0 WHERE id=?').run(owner.id);const cookie=(await createSession(app.db,owner,false)).split(';')[0];const post=body=>app.handle(new Request('https://voice.test/api/calls',{method:'POST',headers:{Origin:'https://voice.test',Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(body)}));assert.equal((await post({action:'dial',targetId:'missing'})).status,503);
 const secret='private-turn-secret-not-sent-to-browser';app.config.turnUrls='turns:relay.example.test:5349?transport=tcp';app.config.turnSecret=secret;
 app.db.sql.prepare("INSERT INTO users (id,email,name,role,status,staff_groups,created_at,password_hash) VALUES ('relay-student','relay@student.test','Relay Student','student','active','[]',?,?)").run(new Date().toISOString(),owner.password_hash);
 const started=await post({action:'dial',targetId:'relay-student'});assert.equal(started.status,200);const body=await started.json();assert.equal(body.iceServers.length,1);assert.ok(body.iceServers[0].username.endsWith(':'+owner.id));assert.ok(body.iceServers[0].credential.length>20);assert.ok(!JSON.stringify(body).includes(secret));assert.ok(Number(body.iceServers[0].username.split(':')[0])>Date.now()/1000);
}finally{await app.close();await rm(dir,{recursive:true,force:true})}
});
