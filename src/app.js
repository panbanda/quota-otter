import { empty, uid, normalizeLimits, status, summarize, countdown, exportConfig, validateConfig, demoState, normalizeClaude, mergeConfig, restoreLocal } from './core.js';
import { APP_VERSION } from './version.js';
const native = Boolean(window.__TAURI__);
const invoke = (cmd, args={}) => native ? window.__TAURI__.core.invoke(cmd,args) : Promise.reject(Error('Open the desktop app to connect accounts. This browser preview supports groups and manual tracking.'));
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let state, startupError;
try { const saved=localStorage.getItem('quota-otter-v1'); state=saved?restoreLocal(JSON.parse(saved)):empty(); } catch { state=empty();startupError='Saved settings could not be loaded. The previous copy has not been overwritten.'; }
let demo=false, realState, selected='all', query='', busy=new Set(), pendingLogin=null, refreshing=false;
let display={bar:true,reset:true,tray:'compact'};
try{const d=JSON.parse(localStorage.getItem('quota-otter-display'));if(d){display={bar:d.bar!==false,reset:d.reset!==false,tray:['compact','detailed','icon'].includes(d.tray)?d.tray:'compact'};}}catch{}
function activity(){
  const list=grouped(),oa=summarize(list,'openai'),cl=summarize(list,'claude');
  const resets=list.filter(a=>['ready','low','exhausted'].includes(status(a).kind)).flatMap(a=>(a.snapshot?.windows||[]).filter(w=>w.resetsAt>Date.now()).map(w=>({name:a.name,time:w.resetsAt}))).sort((a,b)=>a.time-b.time);
  return {oa,cl,group:state.groups.find(g=>g.id===selected)?.name||'All accounts',next:resets[0],unknown:list.filter(a=>['stale','unknown','manual'].includes(status(a).kind)).length};
}
function statusBar(){
  const {oa,cl,group,next,unknown}=activity();
  return `<div class="statusbar" aria-label="Workspace status"><span class="status-group" title="${esc(group)}">${demo?'DEMO · ':''}${esc(group)}</span><span><i class="status-dot ${oa.ready?'ready':''}"></i>OpenAI <strong>${oa.ready}/${oa.total}</strong></span><span><i class="status-dot ${cl.ready?'ready':''}"></i>Claude <strong>${cl.ready}/${cl.total}</strong></span><span class="status-reset">${refreshing?'Refreshing…':unknown?`${unknown} unconfirmed`:oa.total+cl.total?'Readings current':'No accounts yet'}</span>${display.reset?`<span class="status-reset" title="${esc(next?.name||'')}">${next?`Next reported reset · ${countdown(next.time)}`:'Next reset unknown'}</span>`:''}<button class="status-settings" data-action="display" aria-label="Status bar and tray settings">Display options</button></div>`;
}
function displayForm(){
  modal(`<h2>At a glance</h2><p>Choose what stays visible while you work. Counts show confirmed available accounts, not pooled quota.</p><form id="display-form"><fieldset><legend>Workspace status bar</legend><label><input type="checkbox" name="bar" ${display.bar?'checked':''}>Show the bottom status bar</label><label><input type="checkbox" name="reset" ${display.reset?'checked':''}>Show the next reported reset</label></fieldset><label for="tray-style">System tray summary</label><select name="tray" id="tray-style"><option value="compact">Compact · OA 2/3 · CL 1/2</option><option value="detailed">Detailed · vendors, freshness and next reset</option><option value="icon">Icon only · details in the tray menu</option></select><p class="manual-hint">Menu-bar text is available on macOS. Windows shows details in the tray tooltip and menu; Linux uses the tray menu. All follow the selected group.</p><div class="dialog-actions"><button type="button" data-action="close">Cancel</button><button class="primary">Save preferences</button></div></form>`);
  $('#tray-style').value=display.tray;
  $('#display-form').onsubmit=e=>{e.preventDefault();const f=new FormData(e.target);display={bar:f.has('bar'),reset:f.has('reset'),tray:f.get('tray')};try{localStorage.setItem('quota-otter-display',JSON.stringify(display));}catch{toast('Preferences apply now but could not be saved.');}close();render();};
}
function save(){ if(!demo){localStorage.setItem('quota-otter-v1',JSON.stringify({...exportConfig(state),accounts:state.accounts.map(a=>({...exportConfig({groups:[],accounts:[a]}).accounts[0],snapshot:a.snapshot}))}));startupError=null;} }
let toastTimer;
function toast(message){$('#toast').textContent=message;$('#toast').style.display='block';clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').style.display='none',6000);}
function modal(html){$('#dialog').innerHTML=html;$('#dialog').showModal();}
function close(){ $('#dialog').close(); }
function grouped(){return state.accounts.filter(a=>selected==='all'||a.groups.includes(selected));}
function filtered(){return grouped().filter(a=>!query||a.name.toLowerCase().includes(query.toLowerCase()));}
const vendorName=v=>v==='openai'?'OpenAI · Codex':'Claude';
function summaryCard(vendor, accounts){
  const s=summarize(accounts,vendor);
  return `<section class="summary-card ${vendor}"><div class="vendor"><span class="vendor-icon">${vendor==='openai'?'✳':'✺'}</span>${vendorName(vendor)}</div><div class="big">${s.ready} <span>/ ${s.total} accounts confirmed available</span></div><p>${s.best?`Most room: <strong>${esc(s.best.name)}</strong> · ${Math.round(status(s.best).remaining)}% in tightest window`:vendor==='claude'?'Connect Claude Code to see reported capacity':'Connect an account to see current capacity'}</p><div class="summary-bottom"><span>${s.known} of ${s.total} with fresh live limits</span><span>${s.resets===null?'Reset credits unknown':`${s.resets} reset credits · ${s.resetKnown}/${s.total} accounts reporting`}</span></div></section>`;
}
function accountCard(a){
  const s=status(a), snap=a.snapshot, stale=s.kind==='stale';
  const membership=a.groups.map(id=>state.groups.find(g=>g.id===id)?.name).filter(Boolean).join(' · ')||'Ungrouped';
  return `<article class="account ${a.vendor}"><div class="account-head"><div><div class="account-name">${esc(a.name)}</div><div class="account-sub">${vendorName(a.vendor)} · ${esc(membership)}</div>${a.identity?`<div class="account-sub">Signed in as ${esc(a.identity)}</div>`:''}</div><span class="badge ${s.kind}">${s.label}</span></div>
  ${snap?.windows.length?snap.windows.map(w=>`<div class="meter"><div class="meter-head"><span>${esc(w.label)}</span><strong>${stale?'Last: ':''}${Math.round(w.remaining)}% remaining</strong></div><div class="track"><div class="fill ${w.remaining<=15?'low':''}" style="width:${w.remaining}%;opacity:${stale?.4:1}"></div></div><small>${countdown(w.resetsAt)}</small></div>`).join(''):`<p>${a.vendor==='claude'?'Connect a Claude Code usage feed, or add a manual snapshot.':'Sign in to read Codex limits and available reset credits.'}</p>`}
  ${snap?`<p class="manual-hint">${snap.source==='manual'?'Self-reported':'Provider-reported'} · ${new Date(snap.observedAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})} · Reset credits: ${snap.resets??'unknown'}</p>`:''}
  ${a.error?`<div class="error">${esc(a.error)}</div>`:''}
  <div class="account-foot"><span class="meta">${demo?'SAMPLE DATA':a.vendor==='claude'?(snap?.source==='claude-code'?'CLAUDE CODE FEED':'NOT CONNECTED'):'INDEPENDENT SIGN-IN'}</span><div class="actions"><button data-action="edit" data-id="${a.id}" aria-label="Edit ${esc(a.name)}">Edit</button>${a.vendor==='claude'?`<button data-action="bridge" data-id="${a.id}">Connect feed</button><button data-action="manual" data-id="${a.id}">Manual</button>`:`<button data-action="login" data-id="${a.id}" ${busy.has(a.id)||demo?'disabled':''}>${busy.has(a.id)?'Working…':a.snapshot?'Reconnect':'Sign in'}</button>`}</div></div></article>`;
}
function render(){
  const accounts=filtered(), group=state.groups.find(g=>g.id===selected);
  $('#app').innerHTML=`${demo?'<div class="demo-banner">Demo mode · all accounts, percentages, and reset credits below are sample data.</div>':''}<div class="shell"><aside class="sidebar"><div><div class="brand"><img class="mark" src="otter.png" alt="">Quota Otter</div><div class="tagline">A little more headroom</div></div><nav class="nav" aria-label="Groups"><button class="${selected==='all'?'active':''}" data-action="group" data-id="all">▦ &nbsp; All accounts <span class="count">${state.accounts.length}</span></button></nav><div><p class="eyebrow">Your spaces</p><nav class="nav">${state.groups.map(g=>`<button class="${selected===g.id?'active':''}" data-action="group" data-id="${g.id}"><span>◌ &nbsp; ${esc(g.name)}</span><span class="count">${state.accounts.filter(a=>a.groups.includes(g.id)).length}</span></button>`).join('')}<button data-action="groups">+ &nbsp; Manage groups</button></nav></div><div class="sidebar-bottom">${native?'● Desktop companion':'◌ Browser preview'}<br>Account settings stay on this device.<br><button class="quiet linklike" data-action="export">Export setup</button> · <button class="quiet linklike" data-action="import">Import</button><br><button class="quiet linklike" data-action="demo">${demo?'Leave demo':'Explore a demo'}</button></div></aside><main class="main"><div class="topline"><span class="pill">${demo?'Sample workspace':'Your AI, in one place'}</span><p>Small companion. Fewer quota surprises.</p><button data-action="refresh" ${refreshing||demo?'disabled':''}>${refreshing?'Refreshing…':'↻ Refresh'}</button></div><div class="hero"><div><p class="eyebrow">Usage overview</p><h1>${esc(group?.name||'A little room to keep going.')}</h1><p>Keep an eye on your limits. Know which account has room.</p></div><button class="primary" data-action="add">+ Add account</button></div>${startupError?`<div class="error">${esc(startupError)}</div>`:''}<div class="summary">${summaryCard('openai',grouped())}${summaryCard('claude',grouped())}</div><div class="note">OpenAI reports Codex limits. Claude Code can supply usage automatically while active; direct Claude OAuth polling is not officially supported.</div><div class="section-head"><h2>Your accounts <span class="count">&nbsp; ${accounts.length}</span></h2><input class="search" id="search" aria-label="Search accounts" placeholder="Find an account…" value="${esc(query)}"></div><div class="cards">${accounts.length?accounts.map(accountCard).join(''):`<div class="empty"><img class="otter" src="otter.png" alt="Quota Otter" width="70" height="70"><h2>${query?'No matching accounts':'Make some room for your accounts.'}</h2><p>${query?'Try another name.':'Add your workspaces, group them by project or company, and see your available capacity here.'}</p><button class="primary" data-action="add">Add your first account</button> <button data-action="demo">Explore demo</button></div>`}</div><div class="footer"><span>Percentages belong to individual quota windows and are never pooled.<br>Snapshots become stale after 3 minutes or when a reset passes.</span><span>${native?'Tray follows the selected group · refreshes every minute':'Preview mode · install desktop build for OAuth and tray'}<br>v0.1 · Made for a calmer workflow</span></div></main></div>`;
  $('.brand img').src='otter.svg';
  const emptyLogo=$('.empty img');if(emptyLogo)emptyLogo.src='otter.svg';
  $('.topline .pill').textContent=demo?'Demo workspace':'Workspace / Overview';
  $('.topline p').textContent='Your next idea has room.';
  $('.hero .eyebrow').textContent='THE WORKSPACE';
  $('h1').textContent=group?.name||'Room to create.';
  $('.hero > div > p:last-child').textContent='All your accounts. One clear view of what’s available.';
  $('.topline').insertAdjacentHTML('beforeend',`<label class="theme-control"><span class="sr-only">Color theme</span><select id="theme" aria-label="Color theme"><option value="system">◐ System</option><option value="light">☼ Light</option><option value="dark">◑ Dark</option></select></label>`);
  $('#theme').value=window.quotaTheme.preference;
  $('#theme').onchange=e=>window.quotaTheme.set(e.target.value);
  const note=$('.note');const disclosure=document.createElement('details');disclosure.className='coverage';disclosure.innerHTML='<summary>About your quota readings <span>↗</span></summary>';note.replaceWith(disclosure);disclosure.append(note);
  $('.footer').before(disclosure);
  $('.footer > span:last-child').innerHTML=$('.footer > span:last-child').innerHTML.replace('v0.1 ·',`v${esc(APP_VERSION)} ·`);
  $('.sidebar-bottom').insertAdjacentHTML('beforeend','<br><button class="quiet linklike" data-action="display">Status bar & tray</button>');
  if(display.bar)$('#app').insertAdjacentHTML('beforeend',statusBar());
  $('.shell').style.paddingBottom=display.bar?'42px':'0';
  document.querySelectorAll('.nav button[data-action="group"]').forEach(b=>b.setAttribute('aria-current',b.dataset.id===selected?'page':'false'));
  $('#search').addEventListener('input',e=>{const pos=e.target.selectionStart;query=e.target.value;render();$('#search').focus();$('#search').setSelectionRange(pos,pos);});
  updateTray();
}
function updateTray(){if(!native)return;const {oa,cl,group,next,unknown}=activity();const prefix=demo?'DEMO · ':'';const compact=`OA ${oa.ready}/${oa.total} · CL ${cl.ready}/${cl.total}`;const detailed=`OpenAI ${oa.ready}/${oa.total} available · Claude ${cl.ready}/${cl.total} available · ${unknown} unconfirmed`;const title=display.tray==='icon'?(demo?'DEMO':''):prefix+(display.tray==='detailed'?detailed:compact);const summary=`${prefix}${group} | ${display.tray==='compact'?compact+' available':detailed}${display.tray==='detailed'&&display.reset?` | ${next?'Next reported reset: '+countdown(next.time):'Next reset unknown'}`:''} | ${oa.resets??'?'} reset credits (${oa.resetKnown}/${oa.total} reporting)`;invoke('update_tray',{title,summary}).catch(()=>{});}
function accountForm(a){
  modal(`<h2>${a?'Edit account':'Add an account'}</h2><p>Use a recognizable name. An account can belong to several groups.</p><form id="account-form"><label for="name">Account label</label><input id="name" name="name" maxlength="80" required value="${esc(a?.name||'')}" placeholder="e.g. Acme design team"><label for="vendor">Provider</label><select id="vendor" name="vendor" ${a?'disabled':''}><option value="openai" ${a?.vendor==='openai'?'selected':''}>OpenAI · Codex (OAuth)</option><option value="claude" ${a?.vendor==='claude'?'selected':''}>Claude (Claude Code feed or manual)</option></select><fieldset><legend>Groups</legend>${state.groups.length?state.groups.map(g=>`<label><input type="checkbox" name="groups" value="${g.id}" ${(a?.groups||[selected]).includes(g.id)?'checked':''}>${esc(g.name)}</label>`).join(''):'Create a group from the sidebar anytime.'}</fieldset><div class="dialog-actions">${a?'<button type="button" class="danger" id="delete-account">Remove</button>':''}<button type="button" data-action="close">Cancel</button><button class="primary" type="submit">Save account</button></div></form>`);
  $('#account-form').onsubmit=e=>{e.preventDefault();const f=new FormData(e.target);const name=f.get('name').trim();if(!name)return; if(a){a.name=name;a.groups=f.getAll('groups');}else{state.accounts.push({id:uid(),name,vendor:f.get('vendor'),groups:f.getAll('groups')});}save();close();render();};
  if(a)$('#delete-account').onclick=async()=>{if(!confirm(`Remove ${a.name}? Its Quota Otter connection will be cleared. Close any Claude Code session using this feed first.`))return;try{if(native&&!demo){if(a.vendor==='openai')await invoke('disconnect',{id:a.id});else await invoke('remove_claude_feed',{id:a.id});}state.accounts=state.accounts.filter(x=>x.id!==a.id);save();close();render();}catch(e){toast(`Could not sign out; account retained. ${e}`);}};
}
function manualForm(a){
  modal(`<h2>Update Claude usage</h2><p>Copy the remaining percentages and reset times shown by Claude. This snapshot is labeled manual and will not be counted as confirmed live availability.</p><form id="manual-form"><div class="row"><div><label for="session">Session remaining %</label><input id="session" name="session" type="number" min="0" max="100" step="0.1" required></div><div><label for="session-reset">Session reset (local time)</label><input id="session-reset" name="sessionReset" type="datetime-local"></div></div><div class="row"><div><label for="weekly">Weekly remaining % (optional)</label><input id="weekly" name="weekly" type="number" min="0" max="100" step="0.1"></div><div><label for="weekly-reset">Weekly reset (local time)</label><input id="weekly-reset" name="weeklyReset" type="datetime-local"></div></div><p class="manual-hint">An unknown reset stays unknown. A passed reset never automatically refills a quota.</p><div class="dialog-actions"><button type="button" data-action="close">Cancel</button><button type="submit" class="primary">Save snapshot</button></div></form>`);
  $('#manual-form').onsubmit=e=>{e.preventDefault();const f=new FormData(e.target);const windows=[];for(const [key,label] of [['session','Session window'],['weekly','Weekly window']]){if(f.get(key)==='')continue;const date=f.get(key+'Reset');const resetsAt=date?new Date(date).getTime():null;if(resetsAt!==null&&(!Number.isFinite(resetsAt)||resetsAt<=Date.now()))return toast('Choose a future reset time, or leave it blank.');windows.push({label,remaining:Number(f.get(key)),resetsAt});}a.snapshot={source:'manual',observedAt:Date.now(),resets:null,windows};delete a.error;save();close();render();};
}
function groupsForm(){
  modal(`<h2>Your project spaces</h2><p>Group accounts by company, project, or the way you work.</p><div>${state.groups.map(g=>`<div class="group-row"><span>${esc(g.name)}</span><div><button class="quiet" data-rename="${g.id}">Rename</button><button class="quiet danger" data-delete-group="${g.id}">Delete</button></div></div>`).join('')}</div><form id="group-form"><label for="group-name">New group</label><input name="name" id="group-name" maxlength="80" required placeholder="e.g. Client projects"><div class="dialog-actions"><button type="button" data-action="close">Done</button><button class="primary">Add group</button></div></form>`);
  $('#group-form').onsubmit=e=>{e.preventDefault();const name=new FormData(e.target).get('name').trim();if(!name)return;state.groups.push({id:uid(),name});save();close();render();groupsForm();};
  $('#dialog').querySelectorAll('[data-rename]').forEach(b=>b.onclick=()=>{const g=state.groups.find(g=>g.id===b.dataset.rename);const name=prompt('Group name',g.name)?.trim();if(!name||name.length>80)return;g.name=name;save();close();render();groupsForm();});
  $('#dialog').querySelectorAll('[data-delete-group]').forEach(b=>b.onclick=()=>{if(!confirm('Delete this group? Its accounts will stay in All accounts.'))return;state.groups=state.groups.filter(g=>g.id!==b.dataset.deleteGroup);state.accounts.forEach(a=>a.groups=a.groups.filter(id=>id!==b.dataset.deleteGroup));if(selected===b.dataset.deleteGroup)selected='all';save();close();render();groupsForm();});
}
async function bridgeForm(a){
  if(demo)return toast('Leave demo mode to connect a real Claude Code feed.');
  if(!native)return toast('Open the desktop app to create a Claude Code feed.');
  const result=await invoke('prepare_claude_bridge',{id:a.id});
  modal(`<h2>Connect ${esc(a.name)}</h2><p>Run this command in your project terminal. Claude Code will display its normal sign-in flow if needed and send quota readings to this account card.</p><p class="inline-code" style="margin-top:16px"><code>${esc(result.command)}</code></p><p style="margin-top:16px">Requires Node.js and Claude Code v2.1.251 or later. Confirm the correct account in Claude Code before working. This feed is assigned by you; it cannot verify your Claude identity.</p><p style="margin-top:12px">Quota data appears after an API response on supported plans. The feed goes stale when Claude Code stops supplying fresh data. Existing default settings are unchanged; this command selects a session-specific status line.</p><div class="dialog-actions"><button class="primary" data-action="close">Got it</button></div>`);
}
async function refreshAccount(a){
  if(busy.has(a.id))return;
  busy.add(a.id);
  try{if(a.vendor==='openai'){const result=await invoke('read_usage',{id:a.id});a.snapshot=normalizeLimits(result.usage);a.identity=result.account?.email||null;}else{const result=await invoke('read_claude_usage',{id:a.id});if(result)a.snapshot=normalizeClaude(result);else if(a.snapshot?.source!=='manual')a.snapshot=null;}delete a.error;}
  catch(e){a.error=String(e);}
  finally{busy.delete(a.id);}
}
async function refresh(){if(demo||refreshing)return;refreshing=true;render();await Promise.allSettled(state.accounts.map(refreshAccount));refreshing=false;if(!startupError)save();render();}
async function login(a){
  if(demo||pendingLogin)return toast('Finish the current sign-in first.');
  if(!native)return toast('Run the desktop app to connect OpenAI with OAuth.');
  busy.add(a.id);render();pendingLogin={id:a.id,loginId:null};
  modal('<h2>Opening OpenAI sign-in…</h2><p>The official Codex app server handles your sign-in. Quota Otter uses a separate profile for this account.</p>');
  try{
    const r=await invoke('begin_login',{id:a.id});pendingLogin={id:a.id,loginId:r.loginId};
    $('#dialog').innerHTML='<h2>Finish signing in</h2><p>Complete sign-in in your browser, selecting the correct account. Then return here. Your session will remain independent of the browser.</p><div class="dialog-actions"><button id="cancel-login">Cancel sign-in</button><button id="finish-login" class="primary">I’ve signed in</button></div>';
    $('#cancel-login').onclick=cancelLogin;
    $('#finish-login').onclick=async()=>{$('#finish-login').disabled=true;busy.delete(a.id);await refreshAccount(a);render();if(a.error){$('#finish-login').disabled=false;return toast(a.error);}pendingLogin=null;save();close();toast(`Connected ${a.identity||a.name}`);};
  }catch(e){a.error=String(e);pendingLogin=null;close();toast(String(e));busy.delete(a.id);render();}
}
async function cancelLogin(){const p=pendingLogin;if(!p)return;if(!p.loginId)return toast('Waiting for the sign-in window to open.');try{await invoke('cancel_login',{id:p.id,loginId:p.loginId});pendingLogin=null;busy.delete(p.id);close();render();}catch(e){toast(`Cancellation failed: ${e}. Try again.`);}}
$('#dialog').addEventListener('cancel',e=>{if(pendingLogin){e.preventDefault();cancelLogin();}});
async function handle(action,id){
  const a=state.accounts.find(a=>a.id===id);
  if(action==='group'){selected=id;query='';render();}
  if(action==='close')close();
  if(action==='add')accountForm();
  if(action==='edit'&&a)accountForm(a);
  if(action==='manual'&&a)manualForm(a);
  if(action==='bridge'&&a)await bridgeForm(a);
  if(action==='groups')groupsForm();
  if(action==='display')displayForm();
  if(action==='refresh')await refresh();
  if(action==='login'&&a)await login(a);
  if(action==='demo'){if(refreshing||pendingLogin)return toast('Wait for the current connection to finish.');if(!demo){realState=state;state=demoState();demo=true;}else{state=realState;demo=false;}selected='all';query='';render();}
  if(action==='export'){
    const contents=JSON.stringify(exportConfig(state),null,2);
    if(native){if(await invoke('export_setup',{contents}))toast('Setup exported. Sign-ins and usage are excluded.');}
    else{const url=URL.createObjectURL(new Blob([contents],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='quota-otter-setup.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Setup exported. Sign-ins and usage are excluded.');}
  }
  if(action==='import'){
    if(demo)return toast('Leave demo mode before importing.');
    const accept=text=>{const merged=mergeConfig(state,JSON.parse(text));state=merged;save();render();toast('Setup merged. Connect accounts on this machine to fetch usage.');};
    if(native){const text=await invoke('import_setup');if(text!==null)accept(text);}
    else{const input=document.createElement('input');input.type='file';input.accept='.json';input.onchange=async()=>{try{const file=input.files[0];if(!file)return;if(file.size>1_000_000)throw Error('Configuration is too large.');accept(await file.text());}catch(e){toast(String(e));}};input.click();}
  }
}
document.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(b)handle(b.dataset.action,b.dataset.id).catch(e=>toast(String(e)));});
render();
setInterval(()=>{if(!$('#dialog').open&&document.activeElement?.id!=='search')render();},15_000);
if(native){window.__TAURI__.event.listen('refresh-requested',()=>refresh());refresh();}else setInterval(()=>{if(!demo)render();},60_000);
window.addEventListener('focus',()=>{if(native&&!pendingLogin)refresh();});
