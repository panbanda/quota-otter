export const FRESH_MS = 180_000;
export const uid = () => crypto.randomUUID();
export const empty = () => ({ version: 1, groups: [{ id: uid(), name: 'Personal' }], accounts: [] });
export function normalizeLimits(result, now = Date.now()) {
  const buckets = result?.rateLimitsByLimitId && Object.keys(result.rateLimitsByLimitId).length
    ? Object.entries(result.rateLimitsByLimitId) : result?.rateLimits ? [[result.rateLimits.limitId || 'codex', result.rateLimits]] : [];
  const windows = buckets.flatMap(([id, bucket]) => ['primary', 'secondary'].flatMap(slot => {
    const w = bucket?.[slot];
    if (!w || !Number.isFinite(w.usedPercent) || w.usedPercent < 0 || w.usedPercent > 100) return [];
    return [{ label: `${bucket.limitName || id} · ${w.windowDurationMins ? w.windowDurationMins + ' min' : slot}`, remaining: 100 - w.usedPercent, resetsAt: Number.isFinite(w.resetsAt) && w.resetsAt > 0 ? w.resetsAt * 1000 : null }];
  }));
  const count = result?.rateLimitResetCredits?.availableCount;
  return { windows, resets: Number.isInteger(count) && count >= 0 ? count : null, observedAt: now, source: 'live' };
}
export function status(account, now = Date.now()) {
  const s = account.snapshot;
  if (!s || !s.windows.length) return { kind: 'unknown', remaining: null, label: 'Unknown' };
  if (account.error || now - s.observedAt > FRESH_MS || s.observedAt > now + 60_000 || s.windows.some(w => w.resetsAt !== null && w.resetsAt <= now))
    return { kind: 'stale', remaining: null, label: 'Needs refresh' };
  const remaining = Math.min(...s.windows.map(w => w.remaining));
  if (s.source === 'manual') return { kind: 'manual', remaining, label: 'Manual estimate' };
  return { kind: remaining === 0 ? 'exhausted' : remaining <= 15 ? 'low' : 'ready', remaining, label: remaining === 0 ? 'At limit' : remaining <= 15 ? 'Running low' : 'Available' };
}
export function normalizeClaude(data) {
  if (!data || data.version !== 1 || !Number.isFinite(data.observedAt)) throw Error('Invalid Claude Code snapshot');
  const windows = ['five_hour', 'seven_day', 'spend_limit'].flatMap(key=>{
    const w=data.rate_limits?.[key];
    if(!w||!Number.isFinite(w.used_percentage)||w.used_percentage<0||!Number.isFinite(w.resets_at))return [];
    return [{label:({five_hour:'5-hour window',seven_day:'Weekly window',spend_limit:'Spend limit'})[key],remaining:Math.max(0,100-w.used_percentage),resetsAt:w.resets_at*1000}];
  });
  return {windows,observedAt:data.observedAt,source:'claude-code',resets:null};
}
export function summarize(accounts, vendor, now = Date.now()) {
  const list = accounts.filter(a => a.vendor === vendor);
  const ready = list.filter(a => ['ready', 'low'].includes(status(a, now).kind));
  const known = list.filter(a => ['ready', 'low', 'exhausted'].includes(status(a, now).kind));
  const resetKnown = list.filter(a => a.snapshot?.source === 'live' && !a.error && now - a.snapshot.observedAt <= FRESH_MS && a.snapshot.observedAt <= now && a.snapshot.resets !== null);
  return { total: list.length, ready: ready.length, known: known.length,
    best: ready.sort((a,b) => status(b, now).remaining - status(a, now).remaining)[0] || null,
    resets: resetKnown.length ? resetKnown.reduce((s,a) => s+a.snapshot.resets, 0) : null,
    resetKnown: resetKnown.length };
}
export function countdown(time, now = Date.now()) {
  if (!time) return 'Reset unknown';
  const mins = Math.ceil((time - now) / 60_000);
  if (mins <= 0) return 'Reset passed · refresh needed';
  if (mins < 60) return `Resets in ${mins}m`;
  if (mins < 1440) return `Resets in ${Math.floor(mins/60)}h ${mins%60}m`;
  return `Resets in ${Math.floor(mins/1440)}d ${Math.floor(mins%1440/60)}h`;
}
export function exportConfig(state) {
  return { version: 1, groups: state.groups.map(({ id, name }) => ({ id, name })), accounts: state.accounts.map(({ id, name, vendor, groups }) => ({ id, name, vendor, groups })) };
}
export function restoreLocal(data) {
  const state=validateConfig(data);
  state.accounts.forEach((a,i)=>{
    const s=data.accounts[i].snapshot;
    if(!s||!['live','manual','claude-code'].includes(s.source)||!Number.isFinite(s.observedAt)||!Array.isArray(s.windows)||s.windows.length>64)return;
    if(s.windows.some(w=>!w||typeof w.label!=='string'||w.label.length>200||!Number.isFinite(w.remaining)||w.remaining<0||w.remaining>100||(w.resetsAt!==null&&(!Number.isFinite(w.resetsAt)||w.resetsAt<=0))))return;
    a.snapshot={source:s.source,observedAt:s.observedAt,resets:Number.isInteger(s.resets)&&s.resets>=0?s.resets:null,windows:s.windows.map(({label,remaining,resetsAt})=>({label,remaining,resetsAt}))};
    // Restored readings are historical until the provider confirms them again.
    if(s.source!=='manual')a.error='Saved reading · waiting for a fresh observation';
  });
  return state;
}
export function validateConfig(data) {
  const id = v => typeof v === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(v);
  const name = v => typeof v === 'string' && v.trim().length > 0 && v.length <= 80;
  if (!data || data.version !== 1 || !Array.isArray(data.groups) || !Array.isArray(data.accounts) || data.groups.length > 100 || data.accounts.length > 100) throw Error('Not a valid Quota Otter configuration (maximum 100 groups and accounts).');
  if (data.groups.some(g => !g || !id(g.id) || !name(g.name)) || new Set(data.groups.map(g => g.id)).size !== data.groups.length) throw Error('Invalid or duplicate groups.');
  const ids = new Set(data.groups.map(g => g.id));
  if (data.accounts.some(a => !a || !id(a.id) || !name(a.name) || !['openai','claude'].includes(a.vendor) || !Array.isArray(a.groups) || a.groups.some(g => !ids.has(g)) || new Set(a.groups).size !== a.groups.length) || new Set(data.accounts.map(a => a.id)).size !== data.accounts.length) throw Error('Invalid accounts or group memberships.');
  return exportConfig(data);
}
export function mergeConfig(current, incoming) {
  const data=validateConfig(incoming);
  // Work on a copy: a rejected merge must never partially modify the live setup.
  const next=structuredClone(current), groupMap=new Map();
  for(const g of data.groups){
    const existing=next.groups.find(x=>x.id===g.id);
    if(existing&&existing.name!==g.name){const id=uid();groupMap.set(g.id,id);next.groups.push({...g,id});}
    else{groupMap.set(g.id,g.id);if(!existing)next.groups.push(g);}
  }
  for(const incoming of data.accounts){
    const mapped={...incoming,groups:incoming.groups.map(g=>groupMap.get(g))};
    const existing=next.accounts.find(x=>x.id===mapped.id);
    if(existing){if(existing.vendor!==mapped.vendor)throw Error('An account ID has a different provider.');existing.groups=[...new Set([...existing.groups,...mapped.groups])];}
    else next.accounts.push(mapped);
  }
  validateConfig(next);
  return next;
}
export function demoState(now = Date.now()) {
  const groups = [{ id: 'studio', name: 'Design studio' }, { id: 'client', name: 'Client projects' }, { id: 'personal', name: 'Personal' }];
  const snapshot = (remaining, hours, source='live', resets=0) => ({ source, observedAt: now, resets, windows: [{ label: 'Session window', remaining, resetsAt: now+hours*3600_000 }, { label:'Weekly window', remaining:Math.min(remaining+12,100), resetsAt:now+3*86400_000 }] });
  return { version: 1, groups, accounts: [
    { id:'demo-one', name:'Studio workspace',vendor:'openai',groups:['studio'],snapshot:snapshot(76,2,'live',2) },
    { id:'demo-two', name:'Research account',vendor:'claude',groups:['studio','client'],snapshot:snapshot(42,3,'claude-code',null) },
    { id:'demo-three', name:'Client workspace',vendor:'openai',groups:['client'],snapshot:snapshot(0,0.4,'live',1) },
    { id:'demo-four', name:'Side projects',vendor:'openai',groups:['personal'],snapshot:snapshot(12,1,'live',0) }
  ] };
}
