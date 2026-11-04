import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const major=Number(process.versions.node.split('.')[0]);if(major<24){console.error('TC Connect needs Node.js 24 or newer. Install it from https://nodejs.org/en/download');process.exit(1)}
if(!existsSync(resolve('dist/index.html'))){console.error('Built interface missing. Run 01-FIRST-RUN.cmd to build it.');process.exit(1)}
try{const {DatabaseSync}=await import('node:sqlite');const db=new DatabaseSync(':memory:');db.exec('SELECT 1');db.close();await import('sharp');await import('livekit-server-sdk')}catch(e){console.error('Local dependencies are missing or incompatible: '+e.message);console.error('Run 01-FIRST-RUN.cmd with internet access once.');process.exit(1)}
console.log('Local prerequisites passed.');

const html=readFileSync(resolve('dist/index.html'),'utf8');const assets=[...html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)].map(m=>m[1]);if(!assets.length)throw new Error('The built interface has no application assets. Run 01-FIRST-RUN.cmd.');for(const asset of assets){if(!existsSync(resolve('dist','.'+asset)))throw new Error('A required interface file is missing: '+asset+'. Run 01-FIRST-RUN.cmd.');}console.log('Built interface assets verified.');
