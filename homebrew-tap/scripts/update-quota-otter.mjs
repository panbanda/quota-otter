import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const repo='panbanda/quota-otter';
export function cask(version,sha){
  if(!/^\d+\.\d+\.\d+$/.test(version)||!(/^[a-f0-9]{64}$/).test(sha))throw Error('Invalid cask version or checksum');
  return `cask "quota-otter" do
  version "${version}"
  sha256 "${sha}"

  url "https://github.com/panbanda/quota-otter/releases/download/quota-otter-v#{version}/QuotaOtter_#{version}_universal-apple-darwin.dmg"
  name "Quota Otter"
  desc "AI account usage, reset windows, and project groups in your menu bar"
  homepage "https://github.com/panbanda/quota-otter"

  depends_on macos: ">= :monterey"

  app "Quota Otter.app"

  uninstall quit: "app.quotaotter.desktop"

  caveats <<~EOS
    Quota Otter is not signed or notarized by Apple, so macOS refuses to
    launch a quarantined copy. Install it with:
      brew install --cask --no-quarantine panbanda/brews/quota-otter
    If it is already installed, clear the quarantine flag:
      xattr -dr com.apple.quarantine "/Applications/Quota Otter.app"
    Both bypass Gatekeeper's checks on this app. Run them only if you
    trust this release source.

    OpenAI connections require the official native Codex CLI on PATH:
      brew install --cask codex
    Claude Code feeds require Node.js and a supported Claude Code version:
      brew install node
  EOS
end
`;
}
export function compareVersions(a,b){const x=a.split('.').map(Number),y=b.split('.').map(Number);for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]>y[i]?1:-1;return 0;}
export async function update({fetcher=fetch,token=process.env.GH_TOKEN}={}){
  const headers={'Accept':'application/vnd.github+json','User-Agent':'panbanda-homebrew-quota-otter'};
  if(token)headers.Authorization=`Bearer ${token}`;
  const res=await fetcher(`https://api.github.com/repos/${repo}/releases/latest`,{headers,signal:AbortSignal.timeout(30_000)});
  if(res.status===404){console.log('No published Quota Otter release yet; cask unchanged.');return false;}
  if(!res.ok)throw Error(`Release lookup failed: HTTP ${res.status}`);
  const release=await res.json();
  if(release.draft||release.prerelease||!/^quota-otter-v\d+\.\d+\.\d+$/.test(release.tag_name))throw Error('Expected a stable semantic-version release');
  const version=release.tag_name.slice('quota-otter-v'.length),file=`QuotaOtter_${version}_universal-apple-darwin.dmg`;
  const required=[file,`QuotaOtter_${version}_x86_64-pc-windows-msvc.exe`,`QuotaOtter_${version}_x86_64-pc-windows-msvc.msi`,`QuotaOtter_${version}_x86_64-unknown-linux-gnu.deb`,`QuotaOtter_${version}_x86_64-unknown-linux-gnu.AppImage`,'SHA256SUMS'];
  if(required.some(name=>!release.assets?.some(a=>a.name===name))){console.log('Release upload is incomplete; cask unchanged.');return false;}
  let previous;try{previous=await readFile('Casks/quota-otter.rb','utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
  const old=previous?.match(/version "(\d+\.\d+\.\d+)"/)?.[1];
  if(old&&compareVersions(version,old)<=0){console.log('Cask already current; no downgrade or same-version replacement.');return false;}
  const base=`https://github.com/${repo}/releases/download/${release.tag_name}/`;
  const asset=release.assets.find(a=>a.name===file),checksums=release.assets.find(a=>a.name==='SHA256SUMS');
  if(asset.browser_download_url!==base+file||checksums.browser_download_url!==base+'SHA256SUMS')throw Error('Unexpected asset origin');
  const sumResponse=await fetcher(checksums.browser_download_url,{signal:AbortSignal.timeout(30_000)});
  if(!sumResponse.ok)throw Error('Could not download release checksums');
  const sums=await sumResponse.text();if(sums.length>32_000)throw Error('Checksum manifest is too large');
  const matches=sums.trim().split('\n').map(line=>line.trim().split(/\s+/)).filter(row=>row[1]===file);
  if(matches.length!==1||!/^[a-f0-9]{64}$/.test(matches[0][0]))throw Error('Missing or ambiguous DMG checksum');
  const dmg=await fetcher(asset.browser_download_url,{signal:AbortSignal.timeout(180_000)});
  if(!dmg.ok||!dmg.body)throw Error('Could not download macOS installer');
  const hash=createHash('sha256');let bytes=0;
  for await(const chunk of dmg.body){bytes+=chunk.length;if(bytes>512*1024*1024)throw Error('Installer exceeds size limit');hash.update(chunk);}
  const sha=hash.digest('hex');
  if(bytes<1024||sha!==matches[0][0])throw Error('Installer checksum does not match published manifest');
  await mkdir('Casks',{recursive:true});await writeFile('Casks/quota-otter.rb',cask(version,sha));
  console.log(`Prepared Quota Otter ${version}; verified ${bytes} installer bytes.`);return true;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await update();
