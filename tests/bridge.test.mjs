import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
test('Claude bridge writes only quota fields and does not renew freshness on a status rerender',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'quota-otter-test-'));
  try{
    const out=join(dir,'usage.json');
    const data={session_id:'private-session',cost:{total_api_duration_ms:234},transcript_path:'/secret',access_token:'SHOULD_NOT_BE_SAVED',rate_limits:{five_hour:{used_percentage:23,resets_at:2000000000}}};
    const run=input=>spawnSync(process.execPath,[resolve('scripts/claude-statusline.mjs'),'--output',out],{input:JSON.stringify(input),encoding:'utf8'});
    const first=run(data);assert.equal(first.status,0,first.stderr);assert.match(first.stdout,/77% left/);
    const raw=await readFile(out,'utf8');assert(!raw.includes('private-session'));assert(!raw.includes('secret'));assert(!raw.includes('SHOULD_NOT'));
    const one=JSON.parse(raw);assert.equal(run(data).status,0);const two=JSON.parse(await readFile(out,'utf8'));assert.equal(one.observedAt,two.observedAt);
    data.session_id='another-private-session';assert.equal(run(data).status,0);const newSession=JSON.parse(await readFile(out,'utf8'));assert.equal(newSession.observedAt,two.observedAt);assert.equal(newSession.marker,two.marker);
    data.cost.total_api_duration_ms+=100;assert.equal(run(data).status,0);const three=JSON.parse(await readFile(out,'utf8'));assert.notEqual(three.marker,two.marker);
    delete data.rate_limits;assert.equal(run(data).status,0);assert.deepEqual(JSON.parse(await readFile(out,'utf8')).rate_limits,{});
  }finally{await rm(dir,{recursive:true,force:true});}
});
