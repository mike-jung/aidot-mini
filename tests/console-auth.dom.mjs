// Optional DOM unit test. No browser, rendering, or network traffic is involved.
// Install jsdom@26.1.0 in an isolated QA folder; set AIDOT_JSDOM_PATH to its lib/api.js.
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {JSDOM}=await import(process.env.AIDOT_JSDOM_PATH?pathToFileURL(process.env.AIDOT_JSDOM_PATH).href:'jsdom');
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const scripts=['robot-console.js','console.js'].map(file=>fs.readFileSync(new URL('../public/'+file,import.meta.url),'utf8'));
const passed=[];
const check=(name,condition)=>{assert(condition,name);passed.push(name);};
async function until(fn){for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}throw new Error('DOM unit condition timed out');}
async function page({configured=true,localSetup=false,language='ko'}={}){
  const dom=new JSDOM(html,{url:'https://console.example.test/',runScripts:'outside-only'}),w=dom.window,d=w.document;
  const calls=[],errors=[];let signedIn=false,loginMethod='password',currentUser='admin',currentPassword='unit password only',csrf='unit-csrf';
  w.addEventListener('error',event=>errors.push(event.message));
  const response=(status,data)=>({status,ok:status<400,json:async()=>({code:status,data})});
  const account=()=>({configured,username:configured?currentUser:'',loginMethod,rememberDays:7,sessionMinutes:60,csrfToken:csrf,language});
  w.fetch=async(url,options={})=>{
    const body=options.body?JSON.parse(options.body):null;calls.push({url,method:options.method||'GET',body});
    if(url==='/admin/preferences')return response(200,{language,version:'0.4.1'});
    if(url==='/admin/auth')return response(200,{configured,localSetup,rememberDays:7,sessionMinutes:60});
    if(url==='/admin/login'||url==='/admin/setup'){
      if(url==='/admin/setup'){configured=true;currentUser=body.username;currentPassword=body.password;}
      else if(!body.token&&(body.username!==currentUser||body.password!==currentPassword))return response(401,{});
      signedIn=true;loginMethod=body.token?'key':'password';return response(200,account());
    }
    if(!signedIn)return response(401,{});
    if(options.body&&options.headers['X-CSRF-Token']!==csrf)return response(403,{});
    if(url==='/admin/session')return response(200,account());
    if(url==='/admin/logout'){signedIn=false;return response(200,{});}
    if(url==='/admin/account'&&options.method==='PUT'){
      if(configured&&loginMethod==='password'&&body.currentPassword!==currentPassword)return response(401,{});
      configured=true;currentUser=body.username;currentPassword=body.password;loginMethod='password';csrf+='-rotated';return response(200,account());
    }
    if(url==='/admin/account')return response(200,account());
    if(url==='/admin/status')return response(200,{db:true,migration:true,uptimeSec:10,rssMB:30,controllers:[],services:[],queries:[],version:'0.4.1',node:'unit'});
    if(url==='/admin/features')return response(200,{robot:false});
    if(url==='/admin/settings')return response(200,{effective:{host:'127.0.0.1',port:8901,https:false,language:'ko',logLevel:'info'},saved:{},locked:[],restartRequired:false});
    throw new Error('Unexpected mock API: '+url);
  };
  for(const source of scripts)w.eval(source);
  await until(()=>d.documentElement.dataset.consoleReady==='true');
  const el=id=>d.getElementById(id);
  const fill=(id,value)=>{el(id).value=value;};
  const submit=async(id)=>{const b=el(id).querySelector('button[type=submit]');el(id).dispatchEvent(new w.Event('submit',{cancelable:true,bubbles:true}));await until(()=>!b.disabled);};
  return {dom,w,d,el,fill,submit,calls,errors};
}
const fresh=await page({configured:false,localSetup:true});
try{
  check('Fresh setup displays ID/password/confirmation',!fresh.el('setup-confirm').hidden&&fresh.el('password-confirm').required&&fresh.el('login-submit').textContent.includes('계정'));
  fresh.fill('password','unit new password');fresh.fill('password-confirm','does not match');await fresh.submit('login-form');
  check('Confirmation mismatch stops submission',!fresh.calls.some(c=>c.url==='/admin/setup')&&fresh.el('message').textContent.includes('일치'));
  fresh.fill('password-confirm','unit new password');fresh.el('remember').checked=true;await fresh.submit('login-form');
  check('Setup completes into workspace and sends remember choice',fresh.el('login').hidden&&!fresh.el('workspace').hidden&&fresh.calls.find(c=>c.url==='/admin/setup').body.remember===true);
  check('Submitted password is removed from inputs',fresh.el('password').value===''&&fresh.el('password-confirm').value==='');
  check('Fresh setup has no script exceptions',fresh.errors.length===0);
}finally{fresh.dom.window.close();}
const normal=await page();
try{
  check('Existing account shows ID/password login with key option collapsed',normal.el('setup-confirm').hidden&&!normal.el('key-login').open);
  normal.el('language').value='en';normal.el('language').dispatchEvent(new normal.w.Event('change'));
  check('English login and duration labels are translated',normal.el('login-submit').textContent==='Administrator sign-in'&&normal.el('remember-label').textContent.includes('7 days'));
  normal.d.querySelector('[data-password-target="password"]').click();check('Password visibility control works',normal.el('password').type==='text');
  normal.fill('password','incorrect');await normal.submit('login-form');check('Wrong credentials stay at login with useful message',!normal.el('login').hidden&&normal.el('message').textContent.includes('ID and password'));
  normal.fill('password','unit password only');await normal.submit('login-form');check('Password login opens overview',normal.el('login').hidden&&!normal.el('overview').hidden);
  normal.d.querySelector('[data-tab="settings"]').click();await until(()=>normal.el('account-username').value==='admin');
  check('Account settings require the current password',normal.el('current-password').required&&!normal.el('current-password-row').hidden);
  normal.fill('new-password','replacement password');normal.fill('new-password-confirm','replacement password');normal.fill('current-password','wrong');await normal.submit('account-form');
  check('Wrong current password preserves the signed-in settings screen',normal.el('login').hidden&&normal.el('message').textContent.includes('current password'));
  normal.fill('current-password','unit password only');await normal.submit('account-form');
  check('Account save keeps a working new session and clears password fields',normal.el('login').hidden&&normal.el('new-password').value===''&&normal.el('message').textContent.includes('Account saved'));
  normal.el('logout').click();await until(()=>!normal.el('login').hidden);check('Logout returns to ID/password login',!normal.el('login').hidden&&normal.el('workspace').hidden);
  check('Normal login has no script exceptions',normal.errors.length===0);
}finally{normal.dom.window.close();}
const legacy=await page({configured:false,localSetup:false});
try{
  check('Upgrade explains local account command',legacy.el('account-setup-help').textContent.includes('npm run admin:account'));
  legacy.fill('token','synthetic-key-for-unit-test-only-0123456789');await legacy.submit('key-login-form');
  check('Legacy key login opens account setup without current password',legacy.el('login').hidden&&!legacy.el('settings').hidden&&legacy.el('current-password-row').hidden&&!legacy.el('current-password').required);
  check('Legacy conversion has no script exceptions',legacy.errors.length===0);
}finally{legacy.dom.window.close();}
console.log(JSON.stringify({status:'passed',scope:'DOM unit tests with mocked API responses; no real browser or network',checks:passed.length,passed},null,2));
