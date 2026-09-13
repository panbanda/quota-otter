import {readFile} from 'node:fs/promises';
const tag=process.env.RELEASE_TAG;
if(!/^v\d+\.\d+\.\d+$/.test(tag||''))throw Error('Release tags must be vMAJOR.MINOR.PATCH');
const expected=tag.slice(1);
const pkg=JSON.parse(await readFile('package.json','utf8'));
const tauri=JSON.parse(await readFile('src-tauri/tauri.conf.json','utf8'));
const cargo=await readFile('src-tauri/Cargo.toml','utf8');
if(pkg.version!==expected||tauri.version!==expected||!cargo.includes(`version = "${expected}"`))throw Error('Package, Cargo and Tauri versions must match the release tag.');
console.log(`Versions agree: ${expected}`);
