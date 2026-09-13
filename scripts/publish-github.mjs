// Run locally with your own authenticated GitHub CLI. No tokens are accepted in arguments.
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdtemp,cp,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
function run(bin,args,cwd=root){const r=spawnSync(bin,args,{cwd,stdio:'inherit',shell:false});if(r.error)throw r.error;if(r.status!==0)throw Error(`${bin} ${args[0]} failed (${r.status}). Nothing was force-pushed.`);}
function capture(bin,args,cwd=root){return spawnSync(bin,args,{cwd,encoding:'utf8',shell:false});}
run('gh',['auth','status']);
if(!existsSync(join(root,'.git')))run('git',['init','-b','main']);
const branch=capture('git',['branch','--show-current']).stdout.trim();if(branch!=='main')throw Error('Switch this source checkout to main before publishing.');
const remote=capture('git',['remote','get-url','origin']);
if(remote.status===0&&!/^(https:\/\/github\.com\/|git@github\.com:)panbanda\/quota-otter(?:\.git)?$/.test(remote.stdout.trim()))throw Error('Origin is not panbanda/quota-otter; refusing to replace it.');
run('git',['add','.']);
const diff=capture('git',['diff','--cached','--quiet']);if(diff.status===1)run('git',['commit','-m','feat: build Quota Otter desktop companion']);else if(diff.status!==0)throw Error('Could not inspect staged changes');
const repo=capture('gh',['repo','view','panbanda/quota-otter','--json','name']);
if(repo.status!==0)run('gh',['repo','create','panbanda/quota-otter','--public','--description','A little more headroom: cross-platform AI account usage and reset tracking']);
if(remote.status!==0)run('git',['remote','add','origin','https://github.com/panbanda/quota-otter.git']);
run('git',['push','-u','origin','main']);
const scratch=await mkdtemp(join(tmpdir(),'quota-otter-tap-')),tap=join(scratch,'tap');
run('gh',['repo','clone','panbanda/homebrew-brews',tap]);
run('git',['switch','-c','quota-otter-cask-ci'],tap);
for(const dir of ['.github/workflows','scripts'])await mkdir(join(tap,dir),{recursive:true});
for(const path of ['.github/workflows/quota-otter.yml','scripts/update-quota-otter.mjs'])await cp(join(root,'homebrew-tap',path),join(tap,path));
run('git',['add','.github/workflows/quota-otter.yml','scripts/update-quota-otter.mjs'],tap);
run('git',['commit','-m','ci: publish verified Quota Otter cask from releases'],tap);
run('git',['push','-u','origin','quota-otter-cask-ci'],tap);
run('gh',['pr','create','--repo','panbanda/homebrew-brews','--base','main','--head','quota-otter-cask-ci','--title','Publish Quota Otter cask from verified releases','--body','Adds a scheduled/manual updater for panbanda/quota-otter. It waits for all release installers, hashes the universal macOS DMG against SHA256SUMS, and only then updates the cask. No cross-repository secret is required. No cask is added until a complete release exists.'],tap);
console.log('Source pushed and tap PR opened. Wait for CI, review the tap PR, then follow PUBLISHING.md to tag a release.');
console.log(`Tap working copy retained at ${tap}`);
