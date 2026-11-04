import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {resolveAsset} from '../server/assets.mjs';
test('Built frontend assets resolve on Windows, including paths with spaces',()=>{
 const root='C:\\Users\\Student\\Downloads\\TC Connect Full\\dist';
 assert.equal(resolveAsset(root,'/assets/index-abc.js',path.win32),root+'\\assets\\index-abc.js');
 assert.equal(resolveAsset(root,'/assets/index-abc.css',path.win32),root+'\\assets\\index-abc.css');
 assert.equal(resolveAsset(root,'/favicon.svg',path.win32),root+'\\favicon.svg');
 assert.equal(resolveAsset(root,'/',path.win32),root+'\\index.html');
 assert.throws(()=>resolveAsset(root,'/../server/security.mjs',path.win32),{status:404});
 assert.throws(()=>resolveAsset(root,'/%2e%2e%5cserver%5csecurity.mjs',path.win32),{status:404});
 assert.throws(()=>resolveAsset(root,'/../dist-evil/index.js',path.win32),{status:404});
});
test('Built frontend assets remain confined on Linux (Railway)',()=>{
 const root='/app/dist';
 assert.equal(resolveAsset(root,'/assets/index-abc.js',path.posix),'/app/dist/assets/index-abc.js');
 assert.equal(resolveAsset(root,'/',path.posix),'/app/dist/index.html');
 assert.throws(()=>resolveAsset(root,'/../server/security.mjs',path.posix),{status:404});
 assert.throws(()=>resolveAsset(root,'/%2e%2e/server/security.mjs',path.posix),{status:404});
 assert.throws(()=>resolveAsset(root,'/../dist-evil/index.js',path.posix),{status:404});
});
