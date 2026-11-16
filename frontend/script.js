'use strict';
const $ = id => document.getElementById(id);
let tokens = JSON.parse(sessionStorage.getItem('gfgpay_session') || 'null');
let user = null, page = 1, refreshPromise = null, paymentBusy = false;
const money = value => new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(value);
const fields = form => Object.fromEntries(new FormData(form));
function message(text, error = false) { $('message').textContent = text; $('message').className = error ? 'error' : ''; }
function saveSession(value) { tokens=value; if(value) sessionStorage.setItem('gfgpay_session',JSON.stringify(value)); else sessionStorage.removeItem('gfgpay_session'); }
function signedOut() { $('register').hidden=true; $('login').hidden=false; $('authTitle').textContent='Log in'; $('toggleAuth').textContent='Create an account'; saveSession(null); user=null; $('app').hidden=true; $('auth').hidden=false; document.querySelectorAll('#app form').forEach(f=>f.reset()); }
async function api(path, options={}, retry=true) {
 const controller=new AbortController(); const timeout=setTimeout(()=>controller.abort(),20000);
 let response;
 try { response=await fetch('/api/v1'+path,{...options,signal:controller.signal,headers:{'Content-Type':'application/json',...(tokens?{Authorization:'Bearer '+tokens.access.token}:{}),...options.headers}}); }
 catch { const e=new Error('Connection interrupted. Payment status may be unknown.'); e.network=true; throw e; }
 finally {clearTimeout(timeout);}
 if(response.status===401 && tokens && retry && !['/auth/login','/auth/register','/auth/refresh-tokens','/auth/logout'].includes(path)) {
  if(!refreshPromise) refreshPromise=api('/auth/refresh-tokens',{method:'POST',body:JSON.stringify({refreshToken:tokens.refresh.token})},false).then(r=>saveSession(r.data.tokens)).finally(()=>{refreshPromise=null;});
  try {await refreshPromise;} catch(e) {signedOut();throw e;}
  return api(path,options,false);
 }
 const result=await response.json();
 if(!response.ok){const e=new Error(result.message||'Request failed');e.status=response.status;throw e;}
 return result;
}
const post = (path,body) => api(path,{method:'POST',body:JSON.stringify(body)});
function bindForm(id, handler) {$(id).addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget;const button=form.querySelector('button');if(button.disabled)return;button.disabled=true;try{await handler(fields(form),form);}catch(err){message(err.message,true);}finally{button.disabled=false;}});}
function action(id, fn){$(id).addEventListener('click',()=>Promise.resolve().then(fn).catch(e=>message(e.message,true)));}
async function view(id){document.querySelectorAll('.view').forEach(el=>{el.hidden=el.id!==id;});document.querySelectorAll('[data-view]').forEach(el=>el.setAttribute('aria-current',el.dataset.view===id?'page':'false'));if(id==='history')await history();if(id==='analytics')await analytics();if(id==='settings')await banks();}
document.querySelectorAll('[data-view]').forEach(el=>el.addEventListener('click',()=>view(el.dataset.view).catch(e=>message(e.message,true))));
action('toggleAuth',()=>{const registering=$('register').hidden;$('register').hidden=!registering;$('login').hidden=registering;$('authTitle').textContent=registering?'Create account':'Log in';$('toggleAuth').textContent=registering?'Back to login':'Create an account';});
async function enter(){const r=await api('/auth/profile');user=r.data.user;$('name').textContent=user.fullName;$('upi').textContent=user.upiId;$('auth').hidden=true;$('app').hidden=false;showPending();await view('dashboard');await dashboard();}
bindForm('login',async(body,form)=>{const r=await post('/auth/login',body);saveSession(r.data.tokens);form.reset();await enter();message('Logged in.');});
bindForm('register',async(body,form)=>{const r=await post('/auth/register',body);saveSession(r.data.tokens);form.reset();await enter();await view('settings');message('Account created. Choose a transaction PIN in Settings.');});
action('logout',async()=>{try{await post('/auth/logout',{refreshToken:tokens.refresh.token});}finally{signedOut();message('Logged out on this device.');}});
async function dashboard(){const [balance,contacts]=await Promise.all([api('/wallet/balance'),api('/transactions/contacts')]);$('balance').textContent=money(balance.data.balance);$('limit').textContent='Remaining daily spending limit: '+money(balance.data.remainingDailyLimit);$('contacts').replaceChildren(new Option('Choose a contact',''));contacts.data.contacts.forEach(c=>$('contacts').add(new Option(c.fullName||`${c.firstName} ${c.lastName}`,c.upiId)));}
$('contacts').addEventListener('change',()=>{$('transfer').elements.recipient.value=$('contacts').value;});action('refresh',dashboard);
function pendingKey(){return 'gfgpay_pending_'+user._id;}
function pending(){return JSON.parse(localStorage.getItem(pendingKey())||'null');}
function showPending(){const p=pending();$('pending').hidden=!p;if(p)$('pendingText').textContent=`${money(p.body.amount)} · ${p.body.receiverUpiId||p.body.receiverPhone||p.path}. Check status before making another payment.`;}
async function payment(path,body,existing=null){
 if(paymentBusy)throw new Error('A payment is already being submitted.');
 if(!user)throw new Error('Log in first.');
 if(pending()&&!existing)throw new Error('Resolve the pending payment first.');
 const ownerKey=pendingKey();const safeBody={...body};delete safeBody.pin;
 const p=existing||{key:crypto.randomUUID(),path,body:safeBody};
 localStorage.setItem(ownerKey,JSON.stringify(p));showPending();paymentBusy=true;
 try{const r=await api(path,{method:'POST',headers:{'Idempotency-Key':p.key},body:JSON.stringify(body)});
  if(r.data.status==='completed'){localStorage.removeItem(ownerKey);message(`Confirmed: ${money(r.data.amount)} · ${r.data.referenceId}`);}else message('Payment is processing. Check its status.');
 }catch(e){if([400,403,404,422].includes(e.status))localStorage.removeItem(ownerKey);throw e;}
 finally{paymentBusy=false;if(user)showPending();}
 await dashboard();
}
bindForm('transfer',async(body,form)=>{const receiver=body.recipient.trim();const byUpi=receiver.includes('@');const query=byUpi?'upiId':'phoneNumber';await api('/transfer/verify?'+query+'='+encodeURIComponent(receiver));await payment('/transfer/'+(byUpi?'upi':'phone'),{[byUpi?'receiverUpiId':'receiverPhone']:receiver,amount:Number(body.amount),pin:body.pin,...(body.note?{note:body.note}:{})});form.reset();});
bindForm('topup',async(body,form)=>{await payment('/wallet/add-money',{amount:Number(body.amount),source:'bank'});form.reset();});
bindForm('withdraw',async(body,form)=>{await payment('/wallet/withdraw',{...body,amount:Number(body.amount)});form.reset();});
action('checkPayment',async()=>{const p=pending();if(!p)return;try{const r=await api('/transactions/idempotency/'+p.key);if(r.data.transaction.status==='completed'){localStorage.removeItem(pendingKey());showPending();await dashboard();message('Confirmed: '+r.data.transaction.referenceId);}else message('Payment is still processing.');}catch(e){if(e.status===404)message('No committed payment found. Retry the same payment safely.');else throw e;}});
action('retryPayment',async()=>{const p=pending();if(!p)return;const body={...p.body};if(p.path!=='/wallet/add-money'){body.pin=prompt('Enter your PIN to retry the same payment');if(!body.pin)return;}await payment(p.path,body,p);});
async function history(){const query=new URLSearchParams({page:String(page),limit:'10'});Object.entries(fields($('filters'))).forEach(([k,v])=>{if(v)query.set(k,k==='endDate'?v+'T23:59:59.999Z':v);});const r=await api('/transactions?'+query);$('transactions').replaceChildren();for(const tx of r.data){const el=document.createElement('div');el.className='transaction';el.textContent=`${tx.direction==='debit'?'−':'+'}${money(tx.amount)} · ${tx.description} · ${tx.status} · ${new Date(tx.createdAt).toLocaleString()} · ${tx.referenceId}`;$('transactions').append(el);}if(!r.data.length)$('transactions').textContent='No transactions found.';const p=r.meta.pagination;$('page').textContent=` Page ${p.page} of ${Math.max(p.totalPages,1)} `;$('previous').disabled=!p.hasPrevPage;$('next').disabled=!p.hasNextPage;}
bindForm('filters',async()=>{page=1;await history();});action('previous',async()=>{page--;await history();});action('next',async()=>{page++;await history();});
async function analytics(){const r=await api('/transactions/summary?period='+$('period').value);const s=r.data.summary;$('summary').textContent=`Sent / withdrawn: ${money(s.totalSent)} · Received / deposited: ${money(s.totalReceived)} · ${s.transactionCount} completed transactions`;}
$('period').addEventListener('change',()=>analytics().catch(e=>message(e.message,true)));
for(const [id,path]of [['setPin','/auth/pin/set'],['changePin','/auth/pin/change'],['password','/auth/password/change']])bindForm(id,async(body,form)=>{const r=await post(path,body);form.reset();if(id==='password')signedOut();message(r.message);});
async function banks(){const r=await api('/bank-accounts');$('banks').replaceChildren();$('withdrawBank').replaceChildren(new Option('Choose account',''));for(const bank of r.data.bankAccounts){const el=document.createElement('div');el.className='bank';const label=document.createElement('span');label.textContent=`${bank.bankName} · ${bank.maskedAccountNumber}${bank.isPrimary?' · Primary':''} `;el.append(label);for(const [text,method,path]of [['Make primary','POST',`/bank-accounts/${bank._id}/primary`],['Remove','DELETE',`/bank-accounts/${bank._id}`]]){const button=document.createElement('button');button.textContent=text;button.addEventListener('click',async()=>{button.disabled=true;try{await api(path,{method});await banks();}catch(e){message(e.message,true);button.disabled=false;}});el.append(button);}$('banks').append(el);$('withdrawBank').add(new Option(`${bank.bankName} ${bank.maskedAccountNumber}`,bank._id));}}
bindForm('addBank',async(body,form)=>{await post('/bank-accounts',body);form.reset();await banks();message('Bank account added for simulated withdrawals.');});
if(tokens)enter().catch(e=>{signedOut();message(e.message,true);});
