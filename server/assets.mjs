import path from 'node:path';
// Use the selected platform's path operations, rather than a literal '/' prefix.
// Exporting the platform parameter lets tests exercise Windows paths on Linux.
export function resolveAsset(root,pathname,platform=path){
 const decoded=decodeURIComponent(pathname);
 if(decoded.includes('\0'))throw Object.assign(new Error('Not found'),{status:404});
 const candidate=platform.resolve(root,'.'+decoded);
 const rel=platform.relative(root,candidate);
 if(platform.isAbsolute(rel)||rel==='..'||rel.startsWith('..'+platform.sep))throw Object.assign(new Error('Not found'),{status:404});
 return platform.extname(candidate)?candidate:platform.join(root,'index.html');
}
