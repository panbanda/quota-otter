import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {cask,compareVersions,update} from '../homebrew-tap/scripts/update-quota-otter.mjs';
test('cask generator rejects injected versions/checksums and compares versions numerically',()=>{
  assert.throws(()=>cask('0.1.0";evil','a'.repeat(64)));assert.throws(()=>cask('0.1.0','bad'));assert.equal(compareVersions('0.10.0','0.2.0'),1);
});
test('tap updater refuses bad checksums, writes verified casks, and never downgrades',async()=>{
  const original=process.cwd(),dir=await mkdtemp(join(tmpdir(),'quota-otter-release-'));process.chdir(dir);
  try{
    let version='0.1.0',bad=true;const payload=Buffer.alloc(2048,42),sha=createHash('sha256').update(payload).digest('hex');
    const fetcher=async url=>{
      const prefix=`QuotaOtter_${version}_`,file=prefix+'universal-apple-darwin.dmg';
      if(url.includes('api.github.com')){
        const names=[file,prefix+'x86_64-pc-windows-msvc.exe',prefix+'x86_64-pc-windows-msvc.msi',prefix+'x86_64-unknown-linux-gnu.deb',prefix+'x86_64-unknown-linux-gnu.AppImage','SHA256SUMS'];
        return Response.json({tag_name:'v'+version,draft:false,prerelease:false,assets:names.map(name=>({name,browser_download_url:`https://github.com/panbanda/quota-otter/releases/download/v${version}/${name}`}))});
      }
      if(url.endsWith('SHA256SUMS'))return new Response(`${bad?'0'.repeat(64):sha}  ${file}\n`);
      return new Response(payload);
    };
    await assert.rejects(update({fetcher,token:''}),/checksum does not match/);
    await assert.rejects(readFile('Casks/quota-otter.rb'),{code:'ENOENT'});
    bad=false;assert.equal(await update({fetcher,token:''}),true);const text=await readFile('Casks/quota-otter.rb','utf8');assert(text.includes(sha));
    version='0.0.9';assert.equal(await update({fetcher,token:''}),false);assert.equal(await readFile('Casks/quota-otter.rb','utf8'),text);
  }finally{process.chdir(original);await rm(dir,{recursive:true,force:true});}
});
