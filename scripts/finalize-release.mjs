import {readFile,readdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const tag=process.env.RELEASE_TAG;
if(!/^quota-otter-v\d+\.\d+\.\d+$/.test(tag||''))throw Error('Invalid release tag');
const version=tag.slice('quota-otter-v'.length),prefix=`QuotaOtter_${version}_`;
const expected=[`${prefix}universal-apple-darwin.dmg`,`${prefix}x86_64-pc-windows-msvc.exe`,`${prefix}x86_64-pc-windows-msvc.msi`,`${prefix}x86_64-unknown-linux-gnu.deb`,`${prefix}x86_64-unknown-linux-gnu.AppImage`];
const actual=await readdir('release-assets');
if(expected.some(x=>!actual.includes(x))||actual.some(x=>!expected.includes(x)))throw Error('Unexpected or incomplete release artifacts');
const rows=[];for(const file of expected){const data=await readFile(`release-assets/${file}`);if(data.length<1024)throw Error('Installer is suspiciously small');rows.push(`${createHash('sha256').update(data).digest('hex')}  ${file}`);}
await writeFile('release-assets/SHA256SUMS',rows.join('\n')+'\n');
