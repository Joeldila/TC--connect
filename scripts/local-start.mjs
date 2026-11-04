import {createServer} from 'node:http';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';
import {spawn} from 'node:child_process';
import {openDatabase} from '../server/db.mjs';
import {hashPassword} from '../server/security.mjs';
import {createApplication} from '../server/index.mjs';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function initialiseAdministrator(dataDir,{name,email,password}){
 if(typeof name!=='string'||!name.trim()||name.length>100)throw new Error('Enter your full name, up to 100 characters.');
 if(typeof email!=='string'||email.length>150||!/^\S+@\S+\.\S+$/.test(email))throw new Error('Enter a valid administrator email.');
 const hash=await hashPassword(password);
 const db=openDatabase(dataDir);try{db.sql.exec('BEGIN IMMEDIATE');try{if(db.sql.prepare('SELECT id FROM users LIMIT 1').get())throw new Error('The administrator has already been created.');const id=randomUUID();db.sql.prepare("INSERT INTO users (id,email,name,role,status,staff_groups,created_at,password_hash,must_change_password) VALUES (?,?,?,'admin','active','[]',?,?,0)").run(id,email.trim().toLowerCase(),name.trim(),new Date().toISOString(),hash);db.sql.prepare("INSERT INTO settings VALUES ('owner',?)").run(id);db.sql.exec('COMMIT')}catch(e){db.sql.exec('ROLLBACK');throw e}}finally{db.close()}
}
function setupPage(token,error='') {return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TC Connect · Local setup</title><style>*{box-sizing:border-box}body{margin:0;background:#58172a;color:#543240;font:14px/1.7 Arial,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:30px}main{width:490px;max-width:100%;padding:34px;border-radius:13px;background:#fffaf7}small{color:#b28a4d;font-size:10px;letter-spacing:2px}h1{font-size:29px;line-height:1.3;margin:15px 0}p{font-size:12px;color:#9b7e8c}label{display:block;font-size:12px;margin:18px 0 7px;color:#927383}input{width:100%;padding:12px;border:1px solid #deccd4;border-radius:6px;font:14px Arial;background:#fff}button{width:100%;margin-top:24px;padding:13px;color:#fff;background:#681e32;border:0;border-radius:6px;cursor:pointer;font:13px Arial}.error{background:#f9e4e9;color:#a04760;padding:12px;border-radius:7px;font-size:12px}footer{font-size:10px;line-height:1.8;color:#b29aa6;border-top:1px solid #eadde2;margin-top:24px;padding-top:17px}</style></head><body><main><small>TC CONNECT · LOCAL EDITION</small><h1>Start your department workspace.</h1><p>Create your administrator account on this computer. Your database, profile pictures and teaching files stay in the <b>local-data</b> folder.</p>${error?`<p class="error" role="alert">${esc(error)}</p>`:''}<form method="post" action="/setup"><input type="hidden" name="setupToken" value="${token}"><label for="name">Administrator full name</label><input id="name" name="name" autocomplete="name" required maxlength="100"><label for="email">Administrator email</label><input id="email" name="email" type="email" autocomplete="username" required maxlength="150"><label for="password">Choose your password · 12–128 characters</label><input id="password" name="password" type="password" autocomplete="new-password" minlength="12" maxlength="128" required><label for="confirm">Confirm password</label><input id="confirm" name="confirm" type="password" autocomplete="new-password" minlength="12" maxlength="128" required><button>Create administrator & open TC Connect →</button></form><footer>This one-time setup is available only on this computer. There is no default password. Once created, sign in with your new account and configure years, groups and staff.</footer></main></body></html>`;}
export async function startLocal({dataDir=join(root,'local-data'),port=4310,openBrowser=false,host='127.0.0.1',livekit={},onReady=()=>{}}={}){
 if(!['127.0.0.1','::1'].includes(host))throw new Error('Local testing is restricted to this computer. Use Railway for shared access.');
 const fingerprint=createHash('sha256').update(resolve(dataDir)).digest('hex').slice(0,24),token=randomBytes(32).toString('hex');
 const check=openDatabase(dataDir);let hasAdmin;try{hasAdmin=!!check.sql.prepare('SELECT id FROM users LIMIT 1').get()}finally{check.close()}
 let app=null,initialising=false,closing=false,setupFailures=0;let origin='';
 const createApp=()=>createApplication({production:false,localMode:true,dataDir,appUrl:origin,livekitUrl:livekit.url||'',livekitKey:livekit.key||'',livekitSecret:livekit.secret||'',maxParticipants:Number(process.env.MAX_MEETING_PARTICIPANTS||100)});
 const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'same-origin','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"};
 const server=createServer(async(req,res)=>{try{
  if(req.headers.host!==new URL(origin).host){res.writeHead(403,headers);res.end('Open the local address printed in the launcher.');return}
  if(req.url==='/local/status'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'application/json',...headers});res.end(JSON.stringify({app:'TC Connect Local',fingerprint,stage:app?'ready':'setup'}));return}
  if(app){app.server.emit('request',req,res);return}
  if(req.method==='GET'&&(req.url==='/'||req.url==='/setup')){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8',...headers});res.end(setupPage(token));return}
  if(req.method!=='POST'||req.url!=='/setup'){res.writeHead(404,headers);res.end('Not found');return}
  // Native browser form submissions may hide Origin under a privacy/referrer policy.
  // In that narrow case require browser same-origin metadata as well as the setup token below.
  const submittedOrigin=req.headers.origin;
  const nativeSameOrigin=(!submittedOrigin||submittedOrigin==='null')&&req.headers['sec-fetch-site']==='same-origin';
  if(submittedOrigin!==origin&&!nativeSameOrigin){res.writeHead(403,{'Content-Type':'text/html; charset=utf-8',...headers});res.end(setupPage(token,'Reopen the address printed in the launcher, refresh the setup page and submit it again.'));return}
  if(initialising){res.writeHead(409,headers);res.end('Setup is already in progress. Refresh the page.');return}
  if(setupFailures>=12){res.writeHead(429,headers);res.end('Too many setup attempts. Close and reopen the launcher.');return}
  let size=0;const parts=[];for await(const chunk of req){size+=chunk.length;if(size>16384){res.writeHead(413,headers);res.end('Setup form is too large.');return}parts.push(chunk)}
  const fields=new URLSearchParams(Buffer.concat(parts).toString('utf8'));if(fields.get('setupToken')!==token){setupFailures++;res.writeHead(403,headers);res.end('Invalid setup request. Refresh the setup page.');return}
  if(fields.get('password')!==fields.get('confirm')){setupFailures++;res.writeHead(400,{'Content-Type':'text/html; charset=utf-8',...headers});res.end(setupPage(token,'The passwords do not match.'));return}
  initialising=true;
  try{await initialiseAdministrator(dataDir,{name:fields.get('name'),email:fields.get('email'),password:fields.get('password')});hasAdmin=true;app=await createApp();res.writeHead(303,{Location:'/',...headers});res.end();console.log('Administrator created. Sign in in the browser.');onReady({origin,stage:'ready'})}catch(e){setupFailures++;res.writeHead(400,{'Content-Type':'text/html; charset=utf-8',...headers});res.end(setupPage(token,e.message))}finally{initialising=false}
 }catch(e){console.error('Local request failed:',e.message);if(!res.headersSent)res.writeHead(500,headers);res.end('Local startup failed. See the launcher window.')}});
 server.requestTimeout=120000;server.headersTimeout=15000;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve)});
 const address=server.address();origin=`http://${host==='::1'?'[::1]':host}:${address.port}`;
 try{if(hasAdmin)app=await createApp()}catch(e){await new Promise(r=>server.close(r));throw e}
 const close=async()=>{if(closing)return;closing=true;app?.stopRealtime();await new Promise(r=>{server.close(r);server.closeIdleConnections()});if(app)await app.close()};
 const ready={origin,stage:app?'ready':'setup',fingerprint};onReady(ready);
 console.log('\nTC CONNECT — LOCAL EDITION\n');console.log('Open: '+origin);console.log('Data folder: '+resolve(dataDir));console.log('Keep this window open. Press Ctrl+C, or close it, to stop.\n');
 if(openBrowser)launchBrowser(origin);
 return {server,origin,fingerprint,close,get application(){return app}};
}
export function launchBrowser(url){const [exe,args]=process.platform==='win32'?['rundll32',['url.dll,FileProtocolHandler',url]]:process.platform==='darwin'?['open',[url]]:['xdg-open',[url]];try{const child=spawn(exe,args,{detached:true,stdio:'ignore'});child.on('error',()=>console.log('Open this address in your browser: '+url));child.unref()}catch{console.log('Open this address in your browser: '+url)}}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const desired=Number(process.env.LOCAL_PORT||4310);if(!Number.isInteger(desired)||desired<1024||desired>65535)throw new Error('LOCAL_PORT must be between 1024 and 65535.');
 let local;for(let p=desired;p<=Math.min(desired+9,65535);p++){try{local=await startLocal({port:p,openBrowser:true,livekit:{url:process.env.LIVEKIT_URL,key:process.env.LIVEKIT_API_KEY,secret:process.env.LIVEKIT_API_SECRET}});break}catch(e){if(e.code!=='EADDRINUSE')throw e;try{const r=await fetch(`http://127.0.0.1:${p}/local/status`,{signal:AbortSignal.timeout(1000)});const v=await r.json();const expected=createHash('sha256').update(resolve(root,'local-data')).digest('hex').slice(0,24);if(v.app==='TC Connect Local'&&v.fingerprint===expected){console.log('TC Connect is already running. Opening its browser window.');launchBrowser(`http://127.0.0.1:${p}`);process.exit(0)}}catch{}if(p===Math.min(desired+9,65535))throw new Error('No free local port. Close the other local application or set LOCAL_PORT in .env.local.')}}
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await local.close();process.exit(0)});
}
