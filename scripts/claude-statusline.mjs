#!/usr/bin/env node
// Claude Code owns authentication. This bridge receives only documented stdin.
// No credentials, prompts, transcript paths, or account tokens are written.
import { readFile, writeFile, rename, mkdir, unlink } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
const index=process.argv.indexOf('--output');
const output=index>=0?process.argv[index+1]:null;
if(!output||!isAbsolute(output)){process.stderr.write('Expected --output ABSOLUTE_PATH\n');process.exit(1);}
let input='';
for await(const chunk of process.stdin){input+=chunk;if(input.length>1_000_000)process.exit(1);}
try{
  const data=JSON.parse(input), rate_limits={};
  for(const key of ['five_hour','seven_day','spend_limit']){
    const w=data.rate_limits?.[key];
    if(w&&Number.isFinite(w.used_percentage)&&w.used_percentage>=0&&Number.isFinite(w.resets_at))
      rate_limits[key]={used_percentage:w.used_percentage,resets_at:w.resets_at};
  }
  // Statusline rerenders are not quota fetches. Retain the original timestamp
  // until either the usage changes or a new API response changes the cost total.
  const marker=createHash('sha256').update(JSON.stringify([data.cost?.total_api_duration_ms,rate_limits])).digest('hex');
  let previous;try{previous=JSON.parse(await readFile(output,'utf8'));}catch{}
  const observedAt=previous?.marker===marker?previous.observedAt:Date.now();
  await mkdir(dirname(output),{recursive:true,mode:0o700});
  const tmp=`${output}.${process.pid}.tmp`;
  try{await writeFile(tmp,JSON.stringify({version:1,observedAt,marker,rate_limits}),{mode:0o600});await rename(tmp,output);}finally{await unlink(tmp).catch(()=>{});}
  const labels=Object.entries(rate_limits).map(([key,w])=>`${key==='five_hour'?'5h':key==='seven_day'?'7d':'spend'} ${Math.max(0,100-w.used_percentage).toFixed(0)}% left`);
  process.stdout.write(`🦦 ${labels.join(' · ')||'Quota not reported yet'}\n`);
}catch{process.stderr.write('Quota Otter could not parse the Claude Code status payload.\n');process.exitCode=1;}
