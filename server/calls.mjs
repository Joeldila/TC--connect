import {randomUUID,createHmac} from 'node:crypto';
import {canDirect} from './access.mjs';
import {failure as fail} from './security.mjs';
const live=['ringing','connecting','active'];const now=()=>new Date().toISOString();
const json=(d,s=200)=>Response.json(d,{status:s,headers:{'Cache-Control':'no-store'}});
export function createCalls(db,config){
 const q=(s,...a)=>db.sql.prepare(s).get(...a),all=(s,...a)=>db.sql.prepare(s).all(...a),run=(s,...a)=>db.sql.prepare(s).run(...a);
 const subscribers=new Map();
 const active=u=>{if(!u||u.status!=='active'||u.must_change_password)fail('Sign in with an approved account before making a call.',403)};
 function notify(call){for(const uid of [call.caller_id,call.callee_id])for(const send of subscribers.get(uid)||[])send({type:'update',callId:call.id})}
 function finish(c,status,reason){if(!live.includes(c.status))return;db.sql.exec('BEGIN');try{run('UPDATE voice_calls SET status=?,ended_at=?,end_reason=? WHERE id=?',status,now(),reason,c.id);run('DELETE FROM call_locks WHERE call_id=?',c.id);db.sql.exec('COMMIT')}catch(e){db.sql.exec('ROLLBACK');throw e}notify(c)}
 function sweep(){const t=Date.now();for(const c of all("SELECT * FROM voice_calls WHERE status IN ('ringing','connecting','active')")){if(c.status==='ringing'&&t-Date.parse(c.created_at)>45000)finish(c,'missed','No answer');else if(c.status==='connecting'&&t-Date.parse(c.answered_at)>60000)finish(c,'failed','Audio connection could not be established');else if(c.status==='active'&&t-Math.min(Date.parse(c.caller_seen_at),Date.parse(c.callee_seen_at))>180000)finish(c,'failed','A participant disconnected')}run('DELETE FROM call_signals WHERE created_at<? AND call_id IN (SELECT id FROM voice_calls WHERE ended_at IS NOT NULL)',new Date(t-600000).toISOString())}
 function get(u,id){const c=q('SELECT * FROM voice_calls WHERE id=?',id);if(!c||![c.caller_id,c.callee_id].includes(u.id))fail('This private call is unavailable.',403);return c}
 const person=uid=>q('SELECT u.id,u.name,u.role,u.student_no,u.extension,u.avatar,g.name AS group_name,y.name AS year_name FROM users u LEFT JOIN groups g ON g.id=u.group_id LEFT JOIN years y ON y.id=g.year_id WHERE u.id=?',uid);
 const allowed=(u,t)=>canDirect(u,t,all('SELECT * FROM groups'),all('SELECT * FROM modules'),all('SELECT * FROM tickets'));
 function decorate(u,c){const peerId=c.caller_id===u.id?c.callee_id:c.caller_id;return {...c,peer:person(peerId),direction:c.caller_id===u.id?'outgoing':'incoming'}}
 function ice(u){const urls=(config.turnUrls||'').split(',').map(v=>v.trim()).filter(Boolean),stun=(config.stunUrls||'').split(',').map(v=>v.trim()).filter(Boolean);const result=[];if(stun.length)result.push({urls:stun});if(urls.length){if(config.turnSecret){const username=Math.floor(Date.now()/1000+3600)+':'+u.id;result.push({urls,username,credential:createHmac('sha1',config.turnSecret).update(username).digest('base64')})}else if(config.turnUsername&&config.turnPassword)result.push({urls,username:config.turnUsername,credential:config.turnPassword});else fail('TURN credentials have not been configured.',503)}return result}
 function ready(){return !!config.localMode||!!(config.turnUrls&&(config.turnSecret||config.turnUsername&&config.turnPassword))}
 function touch(u){run('INSERT INTO user_presence VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET last_seen_at=excluded.last_seen_at',u.id,now())}
 const timer=setInterval(sweep,10000);timer.unref();
 return {
 disconnect(u){if(!u)return;const lock=q('SELECT call_id FROM call_locks WHERE user_id=?',u.id);if(lock){const c=q('SELECT * FROM voice_calls WHERE id=?',lock.call_id);if(c)finish(c,'ended','A participant signed out')}},
 close(){clearInterval(timer);for(const set of subscribers.values())for(const send of set)send({type:'shutdown'});subscribers.clear()},
 async GET(u,req){active(u);sweep();touch(u);const url=new URL(req.url),id=url.searchParams.get('id'),extension=url.searchParams.get('extension');if(extension){if(!/^\d{6,12}$/.test(extension))fail('Enter a valid TC Connect extension.');const t=q('SELECT * FROM users WHERE extension=?',extension);if(!allowed(u,t))fail('You may call your lecturers, department management or staff handling your request.',403);return json({person:person(t.id),online:!!q('SELECT user_id FROM user_presence WHERE user_id=? AND last_seen_at>?',t.id,new Date(Date.now()-90000).toISOString())})}
 if(id){let c=get(u,id);if(live.includes(c.status))run(`UPDATE voice_calls SET ${c.caller_id===u.id?'caller_seen_at':'callee_seen_at'}=? WHERE id=?`,now(),id);const after=Number(url.searchParams.get('after')||0);if(!Number.isSafeInteger(after)||after<0)fail('Invalid signal cursor');const signals=live.includes(c.status)?all('SELECT seq,kind,payload FROM call_signals WHERE call_id=? AND sender_id<>? AND seq>? ORDER BY seq LIMIT 200',id,u.id,after).map(s=>({...s,payload:JSON.parse(s.payload)})):[];return json({call:decorate(u,c),signals,iceServers:live.includes(c.status)?ice(u):[]})}
 const lock=q('SELECT call_id FROM call_locks WHERE user_id=?',u.id);const current=lock?q('SELECT * FROM voice_calls WHERE id=?',lock.call_id):null;
 return json({user:person(u.id),current:current?decorate(u,current):null,history:all('SELECT * FROM voice_calls WHERE caller_id=? OR callee_id=? ORDER BY created_at DESC LIMIT 60',u.id,u.id).map(c=>decorate(u,c)),configured:ready(),localMode:!!config.localMode});},
 async POST(u,req){active(u);sweep();touch(u);const b=await req.json();
 if(b.action==='dial'){
  if(!ready())fail('Configure TURN_URLS and TURN credentials to enable reliable internet calls. Local testing uses the local launcher.',503);
  const t=b.targetId?q('SELECT * FROM users WHERE id=?',b.targetId):q('SELECT * FROM users WHERE extension=?',String(b.extension||''));if(!allowed(u,t)||t?.must_change_password)fail('This account is outside your permitted calling contacts.',403);
  const servers=ice(u);const id=randomUUID(),stamp=now();db.sql.exec('BEGIN IMMEDIATE');try{if(q('SELECT user_id FROM call_locks WHERE user_id IN (?,?)',u.id,t.id))fail('One of these users is already in a call.',409);run("INSERT INTO voice_calls (id,caller_id,callee_id,status,created_at,caller_seen_at,callee_seen_at) VALUES (?,?,?,'ringing',?,?,?)",id,u.id,t.id,stamp,stamp,stamp);run('INSERT INTO call_locks VALUES (?,?)',u.id,id);run('INSERT INTO call_locks VALUES (?,?)',t.id,id);db.sql.exec('COMMIT')}catch(e){db.sql.exec('ROLLBACK');throw e}const c=get(u,id);notify(c);return json({call:decorate(u,c),iceServers:servers});
 }
 const c=get(u,b.id);
 if(b.action==='accept'){if(c.callee_id!==u.id||c.status!=='ringing')fail('This call cannot be answered now.',409);const caller=q('SELECT * FROM users WHERE id=?',c.caller_id);if(!allowed(u,caller)){finish(c,'failed','Calling permission changed');fail('Calling permission has changed.',403)}run("UPDATE voice_calls SET status='connecting',answered_at=?,callee_seen_at=? WHERE id=?",now(),now(),c.id);notify(c);return json({call:decorate(u,get(u,c.id)),iceServers:ice(u)});}
 if(b.action==='decline'){if(c.callee_id!==u.id||c.status!=='ringing')fail('Only the called user may decline a ringing call.',403);finish(c,'declined','Declined');return json({ok:true});}
 if(b.action==='end'){finish(c,c.status==='ringing'?'cancelled':'ended',typeof b.reason==='string'?b.reason.slice(0,160):'Call ended');return json({ok:true});}
 if(b.action==='failed'){finish(c,'failed','The audio connection failed');return json({ok:true});}
 if(b.action==='connected'){if(!['connecting','active'].includes(c.status))fail('This call is not connecting.',409);const key=c.caller_id===u.id?'caller_connected':'callee_connected';run(`UPDATE voice_calls SET ${key}=1,${c.caller_id===u.id?'caller_seen_at':'callee_seen_at'}=? WHERE id=?`,now(),c.id);const updated=get(u,c.id);if(updated.caller_connected&&updated.callee_connected&&updated.status!=='active'){run("UPDATE voice_calls SET status='active',connected_at=? WHERE id=?",now(),c.id);notify(c)}return json({ok:true});}
 if(b.action==='signal'){
  if(!live.includes(c.status))fail('The call has ended.',409);if(!['offer','answer','ice'].includes(b.kind))fail('Invalid audio negotiation message.');
  if(b.kind==='offer'&&(u.id!==c.caller_id||!['ringing','connecting'].includes(c.status)))fail('Only the caller can offer an audio connection.',403);
  if(b.kind==='answer'&&(u.id!==c.callee_id||c.status!=='connecting'))fail('Only the called user may answer an accepted call.',403);
  if(b.kind==='offer'||b.kind==='answer'){if(b.payload?.type!==b.kind||typeof b.payload.sdp!=='string'||b.payload.sdp.length>100000||!b.payload.sdp.includes('m=audio')||b.payload.sdp.includes('m=video'))fail('A private call must contain audio only.');if(q('SELECT seq FROM call_signals WHERE call_id=? AND sender_id=? AND kind=?',c.id,u.id,b.kind))fail('This connection description was already submitted.',409)}
  else if(!b.payload||typeof b.payload.candidate!=='string'||b.payload.candidate.length>4096)fail('Invalid connection candidate');
  if(q('SELECT COUNT(*) AS n FROM call_signals WHERE call_id=? AND sender_id=?',c.id,u.id).n>300)fail('Too many audio connection messages.',429);
  run('INSERT INTO call_signals (call_id,sender_id,kind,payload,created_at) VALUES (?,?,?,?,?)',c.id,u.id,b.kind,JSON.stringify(b.payload),now());notify(c);return json({ok:true});
 }
 fail('Unknown call action');},
 events(u,valid){active(u);touch(u);let heartbeat,send,done=false;
 const body=new ReadableStream({start(controller){const encoder=new TextEncoder();const stop=()=>{if(done)return;done=true;clearInterval(heartbeat);subscribers.get(u.id)?.delete(send);try{controller.close()}catch{}};send=data=>{if(data.type==='shutdown'){stop();return}try{controller.enqueue(encoder.encode('data: '+JSON.stringify(data)+'\n\n'))}catch{stop()}};if(!subscribers.has(u.id))subscribers.set(u.id,new Set());subscribers.get(u.id).add(send);controller.enqueue(encoder.encode('retry: 2000\n\n'));send({type:'update'});heartbeat=setInterval(async()=>{try{const current=await valid();if(!current||current.status!=='active'||current.must_change_password){stop();return}touch(u);controller.enqueue(encoder.encode(': heartbeat\n\n'))}catch{stop()}},15000);heartbeat.unref()},cancel(){done=true;clearInterval(heartbeat);subscribers.get(u.id)?.delete(send)}});
 return new Response(body,{headers:{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'}});
 }
 };
}
