import {readdir,copyFile,mkdir} from 'node:fs/promises';
import {join,extname} from 'node:path';
const tag=process.env.RELEASE_TAG,target=process.env.BUILD_TARGET;
if(!/^v\d+\.\d+\.\d+$/.test(tag||'')||!['universal-apple-darwin','x86_64-pc-windows-msvc','x86_64-unknown-linux-gnu'].includes(target))throw Error('Invalid release input');
await mkdir('release-assets',{recursive:true});
const extensions=target.includes('darwin')?['.dmg']:target.includes('windows')?['.exe','.msi']:['.deb','.AppImage'];
const found=new Set();
async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){const path=join(dir,e.name);if(e.isDirectory())await walk(path);else if(extensions.includes(extname(e.name))){const ext=extname(e.name);if(found.has(ext))throw Error(`More than one ${ext} installer`);found.add(ext);await copyFile(path,join('release-assets',`QuotaOtter_${tag.slice(1)}_${target}${ext}`));}}}
await walk(join('src-tauri','target',target,'release','bundle'));
if(found.size!==extensions.length)throw Error('An expected installer is missing');
