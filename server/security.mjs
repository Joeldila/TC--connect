import {randomBytes,scrypt as scryptCb,timingSafeEqual,createHash} from 'node:crypto';
import {promisify} from 'node:util';
const scrypt=promisify(scryptCb);
export const digest=t=>createHash('sha256').update(t).digest('hex');
export async function hashPassword(password){if(typeof password!=='string'||password.length<12||password.length>128)throw Object.assign(new Error('Use a password of 12–128 characters.'),{status:400});const salt=randomBytes(16).toString('hex');const key=await scrypt(password,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024});return `scrypt$32768$${salt}$${key.toString('hex')}`;}
export async function verifyPassword(password,encoded){if(typeof password!=='string'||password.length>128)return false;const parts=(encoded||'').split('$');if(parts.length!==4||parts[1]!=='32768')return false;const key=await scrypt(password,parts[2],64,{N:32768,r:8,p:1,maxmem:64*1024*1024});const expected=Buffer.from(parts[3],'hex');return key.length===expected.length&&timingSafeEqual(key,expected);}
export const sessionCookie=(token,production,clear=false)=>`${production?'__Host-':''}tc_session=${clear?'':token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${clear?0:43200}${production?'; Secure':''}`;
export function sessionToken(req,production){const cookies=req.headers.get('cookie')||'';const name=(production?'__Host-':'')+'tc_session';return cookies.split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1)||'';}
export async function createSession(db,user,production){const token=randomBytes(32).toString('base64url');await db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').bind(digest(token),user.id,new Date(Date.now()+43200000).toISOString(),user.password_version).run();return sessionCookie(token,production);}
export async function authenticated(db,req,production){const token=sessionToken(req,production);if(!token)return null;return db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=? AND s.expires_at>? AND s.password_version=u.password_version').bind(digest(token),new Date().toISOString()).first();}
export function publicUser(u){if(!u)return null;const {password_hash,password_version,...safe}=u;return safe;}
export function failure(message,status=400){throw Object.assign(new Error(message),{status});}
