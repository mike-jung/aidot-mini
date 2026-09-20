(async function(){
'use strict';
const $=s=>document.querySelector(s);
const words={
ko:{console:'DEVICE CONSOLE',logout:'로그아웃',welcome:'가볍게 실행하고, 확실하게 관리하세요',signin:'관리자 로그인',intro:'단말과 로봇을 위한 작은 웹서버. 이 기기의 상태와 연결 설정을 관리합니다.',adminKey:'관리자 키',keyHelp:'서버에서 npm run admin:token을 실행해 키를 확인하세요. Android 앱에서는 ‘관리자 키 복사’를 누르세요.',local:'기기에서 직접 실행',noCloud:'클라우드 계정 불필요',workspace:'DEVICE WORKSPACE',title:'서버 관리',subtitle:'연결 상태를 확인하고, 필요한 설정만 간단하게.',refresh:'새로고침',overview:'개요',settings:'설정',samples:'샘플 API',serverStatus:'서버 상태',uptime:'가동 시간',memory:'메모리 사용',db:'데이터베이스',routes:'API 경로',modules:'등록된 모듈',moduleHelp:'컨트롤러와 서비스의 연결 상태를 확인합니다.',controller:'컨트롤러',basePath:'기본 경로',dependencies:'Annotation compiler: esbuild WASM',connection:'서버 연결',settingsHelp:'주소·포트·HTTPS 변경은 서버를 다시 시작하면 적용됩니다.',restart:'저장된 연결 설정을 적용하려면 서버를 다시 시작하세요.',host:'수신 주소',port:'포트',hostHelp:'127.0.0.1: 이 기기만 · 0.0.0.0: 같은 네트워크',tlsHelp:'다른 기기에서 접속하려면 HTTPS가 필요합니다.',cert:'인증서 파일 경로',privateKey:'개인키 파일 경로',certHelp:'서버가 읽을 수 있는 PEM 파일을 지정하세요. 개인키 내용은 화면에 표시하지 않습니다.',defaultLanguage:'기본 언어',logLevel:'로그 수준',consoleAccess:'콘솔 접속 범위',consoleAccessAll:'어디서나',consoleAccessLocal:'이 기기에서만',consoleAccessHelp:'‘이 기기에서만’으로 두면 관리 콘솔은 서버가 도는 기기에서만 열립니다. 업무 API는 영향받지 않습니다. 원격에서는 이 값을 바꿀 수 없습니다.',locked:'비활성화된 항목은 실행 환경에서 관리하고 있습니다.',saveHelp:'저장 전에 설정과 인증서를 검사합니다.',save:'설정 저장',sampleHelp:'메모를 추가해 Controller → Service → SQL의 동작을 확인하세요.',noteTitle:'제목',noteBody:'내용',add:'메모 추가',footer:'Small server. Clear control.',deleteTitle:'메모를 삭제할까요?',cancel:'취소',delete:'삭제',ready:'정상 실행 중',connected:'연결됨',disconnected:'연결 안 됨',ok:'정상',attention:'확인 필요',empty:'메모가 없습니다.',saved:'설정을 저장했습니다.',added:'메모를 추가했습니다.',deleted:'메모를 삭제했습니다.',authError:'관리자 키를 확인하세요.',expired:'로그인이 필요합니다. 다시 로그인하세요.',tooMany:'로그인 시도가 많습니다. 잠시 후 다시 시도하세요.',networkError:'서버에 연결하지 못했습니다. 실행 상태를 확인하세요.',error:'요청을 처리하지 못했습니다.',badSettings:'설정값·인증서 경로와 환경변수 고정 여부를 확인하세요.',forbidden:'요청이 거절되었습니다. 다시 로그인하거나 접속 주소를 확인하세요.',invalid:'입력값을 확인하세요.',units:'개',query:'SQL',service:'서비스'},
en:{console:'DEVICE CONSOLE',logout:'Sign out',welcome:'Sprint Boot style javascript web server for mobile devices, robots and drones',signin:'Administrator sign-in',intro:'A small web server for devices and robots. Manage this device and its connection settings.',adminKey:'Administrator key',keyHelp:'Run npm run admin:token on the server to view your key. In the Android app, tap Copy admin key.',local:'Runs on this device',noCloud:'No cloud account',workspace:'DEVICE WORKSPACE',title:'Server console',subtitle:'Check your connection. Keep your settings simple.',refresh:'Refresh',overview:'Overview',settings:'Settings',samples:'Sample API',serverStatus:'SERVER STATUS',uptime:'Uptime',memory:'Memory usage',db:'Database',routes:'API routes',modules:'Registered modules',moduleHelp:'Inspect connected controllers and services.',controller:'Controller',basePath:'Base path',dependencies:'Annotation compiler: esbuild WASM',connection:'Server connection',settingsHelp:'Address, port and HTTPS changes take effect after restarting the server.',restart:'Restart the server to apply the saved connection settings.',host:'Listen address',port:'Port',hostHelp:'127.0.0.1: this device · 0.0.0.0: local network',tlsHelp:'HTTPS is required for access from other devices.',cert:'Certificate file path',privateKey:'Private key file path',certHelp:'Provide PEM files readable by the server. Private key contents are never displayed.',defaultLanguage:'Default language',logLevel:'Log level',consoleAccess:'Console access',consoleAccessAll:'Anywhere',consoleAccessLocal:'This device only',consoleAccessHelp:'With “This device only”, the admin console opens only on the machine running the server. Business APIs are unaffected. This cannot be changed remotely.',locked:'Disabled settings are managed by the execution environment.',saveHelp:'Settings and certificates are checked before saving.',save:'Save settings',sampleHelp:'Add a note to check the Controller → Service → SQL flow.',noteTitle:'Title',noteBody:'Body',add:'Add note',footer:'Small server. Clear control.',deleteTitle:'Delete this note?',cancel:'Cancel',delete:'Delete',ready:'Server is running',connected:'Connected',disconnected:'Disconnected',ok:'Ready',attention:'Check required',empty:'No notes yet.',saved:'Settings saved.',added:'Note added.',deleted:'Note deleted.',authError:'Check your administrator key.',expired:'Please sign in again.',tooMany:'Too many sign-in attempts. Please try again later.',networkError:'Could not reach the server. Check that it is running.',error:'The request could not be completed.',badSettings:'Check settings, certificate paths and environment-managed values.',forbidden:'Request denied. Sign in again or check the connection address.',invalid:'Check your input.',units:'',query:'SQL',service:'services'}
};
Object.assign(words.ko,{robot:'로봇',live:'실시간 갱신',polling:'주기적 상태 확인',paused:'화면을 열면 갱신'});
Object.assign(words.en,{robot:'Robot',live:'Live updates',polling:'Checking periodically',paused:'Updates resume when visible'});
Object.assign(words.ko,{
  username:'아이디',password:'비밀번호',confirmPassword:'비밀번호 확인',currentPassword:'현재 비밀번호',newPassword:'새 비밀번호',
  showPassword:'표시',hidePassword:'숨김',adminAccount:'관리자 계정',saveAccount:'계정 저장',createAccount:'관리자 계정 만들기',
  passwordHelp:'비밀번호는 12~128자이며 공백도 사용할 수 있습니다. 아이디는 영문·숫자·_.@- 3~64자입니다.',
  remember:'이 기기에서 로그인 유지 ({days}일)',rememberHelp:'본인만 사용하는 기기에서 선택하세요. 선택하지 않으면 최대 {minutes}분 동안 유지됩니다.',
  firstSetup:'처음 한 번 사용할 아이디와 비밀번호를 등록하세요. 이후에는 관리자 키 없이 로그인합니다.',
  legacySetup:'서버에서 npm run admin:account를 실행해 계정을 등록하세요. 기존 키가 있다면 아래에서 한 번 로그인한 뒤 설정에서 등록할 수도 있습니다.',
  keyAlternative:'기존 관리자 키로 전환·복구',keyMigrationHelp:'기존 키로 한 번 로그인한 뒤 설정에서 아이디와 비밀번호를 등록하거나 재설정할 수 있습니다.',keySignIn:'키로 로그인',
  keyHelp:'서버에서 npm run admin:token으로 확인하세요. Android 앱에서는 관리자 키 복사 버튼을 사용하세요.',
  accountHelp:'아이디나 비밀번호를 바꾸려면 현재 비밀번호를 입력하세요.',accountKeyHelp:'관리자 키로 인증했습니다. 사용할 아이디와 새 비밀번호를 저장하세요.',
  accountSaveHelp:'저장 즉시 적용되며 다른 기기의 콘솔 로그인은 해제됩니다.',accountSaved:'계정을 저장했습니다. 다음부터 아이디와 비밀번호로 로그인하세요.',
  passwordMismatch:'비밀번호와 확인 값이 일치하지 않습니다.',authError:'아이디와 비밀번호를 확인하세요.',keyError:'관리자 키를 확인하세요.',currentPasswordError:'현재 비밀번호를 확인하세요.',
  authBusy:'다른 로그인 요청을 확인 중입니다. 잠시 후 다시 시도하세요.',accountExists:'이미 계정이 등록되었습니다. 등록한 아이디와 비밀번호로 로그인하세요.'
});
Object.assign(words.en,{
  username:'ID',password:'Password',confirmPassword:'Confirm password',currentPassword:'Current password',newPassword:'New password',
  showPassword:'Show',hidePassword:'Hide',adminAccount:'Administrator account',saveAccount:'Save account',createAccount:'Create administrator account',
  passwordHelp:'Use 12–128 characters for the password; spaces are allowed. ID: 3–64 letters, digits, or _.@-.',
  remember:'Keep me signed in on this device ({days} days)',rememberHelp:'Use only on your own device. Otherwise, the session lasts up to {minutes} minutes.',
  firstSetup:'Choose your ID and password once. You can then sign in without copying an administrator key.',
  legacySetup:'Run npm run admin:account on the server to create your account. Or sign in once with the existing key below, then create the account in Settings.',
  keyAlternative:'Use an existing key to migrate or recover',keyMigrationHelp:'Sign in once with your existing key, then create or reset the ID and password in Settings.',keySignIn:'Sign in with key',
  keyHelp:'Run npm run admin:token on the server. In the Android app, use the button to copy the administrator key.',
  accountHelp:'Enter your current password to change the ID or password.',accountKeyHelp:'You signed in with an administrator key. Save the ID and new password you want to use.',
  accountSaveHelp:'Applies immediately and signs out other console sessions.',accountSaved:'Account saved. Use your ID and password next time.',
  passwordMismatch:'The password and confirmation do not match.',authError:'Check your ID and password.',keyError:'Check your administrator key.',currentPasswordError:'Check your current password.',
  authBusy:'Another sign-in request is being checked. Please try again shortly.',accountExists:'An account already exists. Sign in with its ID and password.'
});
Object.assign(words.ko,{sampleReadOnly:'공개 조회 예제입니다. 메모 추가·삭제는 인증형 workspace에서 사용할 수 있습니다.',workspacePath:'사용자 workspace 폴더',workspaceHelp:'controller·service·sql을 자동 로딩합니다. 경로 변경 후 서버를 다시 시작하세요.'});
Object.assign(words.en,{sampleReadOnly:'Public read-only example. Use the authenticated workspace to add or delete notes.',workspacePath:'User workspace folder',workspaceHelp:'Automatically load controller, service and sql files. Restart after changing this path.'});
let language='en',explicitLanguage=false;try{const chosen=localStorage.getItem('aidot.language');explicitLanguage=Boolean(chosen&&words[chosen]);language=explicitLanguage?chosen:'en';}catch(e){}
if(!words[language])language='en';
let signedIn=false,csrf='',activeTab='overview',statusData=null,settingsData=null,notes=[],deleteId=null,refreshing=null;
let authData={configured:true,localSetup:false,rememberDays:7,sessionMinutes:60},accountData=null;
Object.assign(words.ko,{edit:'수정',editTitle:'메모 수정',saveNote:'수정 저장',updated:'메모를 수정했습니다.',missingNote:'메모가 삭제되었습니다. 목록을 새로고침하세요.',sampleReadOnly:'조회 API를 확인할 수 있습니다.',sampleHelp:'메모를 조회·추가·수정·삭제하며 API의 동작을 확인하세요.'});
Object.assign(words.en,{edit:'Edit',editTitle:'Edit note',saveNote:'Save changes',updated:'Note updated.',missingNote:'This note was deleted. Refresh the list.',sampleReadOnly:'Explore the read API.',sampleHelp:'List, add, edit and delete notes to try the API.'});
let noteCreate=true,noteUpdate=true,noteDelete=true,editId=null;
let generation=0,serverConnected=false,featuresLoaded=false,stream=null,streamAt=0,nextStreamAt=0,liveMode='polling';
const robotUI=window.AidotRobotConsole.mount({api:api,language:()=>language,message:message});
const toolsUI=window.AidotConsoleTools.mount({api,language:()=>language,message});
const t=k=>words[language][k]||k;
function replaceChildren(el,children){while(el.firstChild)el.removeChild(el.firstChild);children.forEach(child=>el.appendChild(child));}
function translate(){document.documentElement.lang=language;$('#language').value=language;document.querySelectorAll('[data-i18n]').forEach(el=>el.textContent=t(el.dataset.i18n));if(statusData)renderStatus();if(signedIn)renderNotes();robotUI.translate();toolsUI.translate();$('#live-state').textContent=t(liveMode);renderAuth();}
function message(text,error=false){const el=$('#message');el.textContent=text;el.classList.toggle('error',error);el.hidden=!text;}
function closeStream(){if(stream)stream.close();stream=null;streamAt=0;nextStreamAt=0;liveMode=document.hidden?'paused':'polling';$('#live-state').textContent=t(liveMode);}
function showLogin(){generation++;closeStream();signedIn=false;csrf='';serverConnected=false;statusData=null;settingsData=null;featuresLoaded=false;robotUI.session(false);toolsUI.session(false);$('#robot-tab').hidden=true;$('#workspace').hidden=true;$('#login').hidden=false;$('#logout').hidden=true;$('#token').value='';$('#password').value='';$('#password-confirm').value='';$('#remember').checked=false;accountData=null;notes=[];deleteId=null;if($('#delete-dialog').open)$('#delete-dialog').close();if($('#edit-dialog').open)$('#edit-dialog').close();editId=null;clearAccountPasswords();resetPasswordVisibility();renderAuth();}
function showWorkspace(){generation++;signedIn=true;featuresLoaded=false;robotUI.session(true);toolsUI.session(true);$('#workspace').hidden=false;$('#login').hidden=true;$('#logout').hidden=false;}
async function api(url,options={}){
  const requestGeneration=generation;
  let res;
  const controller=typeof AbortController==='function'?new AbortController():null;let timer;
  const headers=Object.assign({},options.body?{'Content-Type':'application/json'}:{},csrf?{'X-CSRF-Token':csrf}:{},options.headers||{});
  const request=Object.assign({},options,{credentials:'same-origin',headers:headers},controller?{signal:controller.signal}:{});
  try{res=await Promise.race([fetch(url,request),new Promise((resolve,reject)=>{timer=setTimeout(()=>{if(controller)controller.abort();reject(new Error('timeout'));},12000);})]);}catch(e){if(requestGeneration!==generation)throw Object.assign(new Error('Stale session response'),{stale:true});throw new Error(t('networkError'));}finally{clearTimeout(timer);}
  const data=await res.json().catch(()=>({}));
  if(requestGeneration!==generation)throw Object.assign(new Error('Stale session response'),{stale:true});
  if(!res.ok){
    if(res.status===401&&!['/admin/login','/admin/account','/admin/setup'].includes(url))showLogin();
    const key=res.status===503&&url.startsWith('/admin/')?'authBusy':res.status===409&&url==='/admin/setup'?'accountExists':res.status===401?(url==='/admin/account'?'currentPasswordError':url==='/admin/login'?'authError':'expired'):res.status===429?'tooMany':res.status===403?'forbidden':url==='/admin/settings'?'badSettings':res.status===400?'invalid':'error';
    throw Object.assign(new Error(t(key)+(data.requestId?` (${data.requestId})`:'')),{status:res.status,reasonCode:data.reasonCode,serverMessage: /^\/admin\/(workspace|logs)\//.test(url)?data.message:undefined});
  }
  if(['/admin/login','/admin/setup','/admin/logout','/admin/account'].includes(url)&&window.aidotMiniNative&&typeof window.aidotMiniNative.flushCookies==='function')window.aidotMiniNative.flushCookies();
  return data;
}
async function busy(form,fn){const button=form.querySelector('button[type="submit"]')||form;button.disabled=true;try{await fn();}catch(e){if(!e.stale)message(e.message,true);}finally{button.disabled=false;}}
$('#language').addEventListener('change',()=>{explicitLanguage=true;language=$('#language').value;try{localStorage.setItem('aidot.language',language);}catch(e){}translate();});
function renderAuth(){
  const setup=!authData.configured&&authData.localSetup;
  $('#login-heading').textContent=t(setup?'createAccount':'signin');$('#login-submit').textContent=t(setup?'createAccount':'signin');
  $('#setup-confirm').hidden=!setup;$('#password-confirm').required=setup;$('#password').minLength=setup?12:1;$('#password').autocomplete=setup?'new-password':'current-password';
  $('#account-setup-help').hidden=authData.configured;$('#account-setup-help').textContent=t(setup?'firstSetup':'legacySetup');
  $('#remember-label').textContent=t('remember').replace('{days}',authData.rememberDays);
  $('[data-i18n="rememberHelp"]').textContent=t('rememberHelp').replace('{minutes}',authData.sessionMinutes);
  if(accountData)$('#account-help').textContent=t(accountData.configured&&accountData.loginMethod==='password'?'accountHelp':'accountKeyHelp');
  document.querySelectorAll('[data-password-target]').forEach(button=>{const visible=$('#'+button.dataset.passwordTarget).type==='text';button.textContent=t(visible?'hidePassword':'showPassword');button.setAttribute('aria-pressed',String(visible));});
}
function resetPasswordVisibility(){document.querySelectorAll('[data-password-target]').forEach(button=>{$('#'+button.dataset.passwordTarget).type='password';});renderAuth();}
function clearAccountPasswords(){for(const id of['current-password','new-password','new-password-confirm'])$('#'+id).value='';}
function selectTab(name){activeTab=name;document.querySelectorAll('[data-tab]').forEach(el=>el.classList.toggle('active',el.dataset.tab===name));document.querySelectorAll('.panel').forEach(el=>el.hidden=el.id!==name);}
async function acceptSession(data,tab='overview'){
  closeStream();csrf=data.csrfToken;accountData=data;authData.configured=data.configured;authData.localSetup=false;
  $('#password').value='';$('#password-confirm').value='';$('#token').value='';clearAccountPasswords();resetPasswordVisibility();
  showWorkspace();selectTab(tab);message('');await refresh();
}
async function loadAuth(){authData=(await api('/admin/auth')).data;renderAuth();}
document.querySelectorAll('[data-password-target]').forEach(button=>button.addEventListener('click',()=>{const input=$('#'+button.dataset.passwordTarget);input.type=input.type==='password'?'text':'password';renderAuth();}));
$('#login-form').addEventListener('submit',e=>{e.preventDefault();busy(e.currentTarget,async()=>{
  const setup=!authData.configured&&authData.localSetup;
  if(setup&&$('#password').value!==$('#password-confirm').value)throw new Error(t('passwordMismatch'));
  try{const r=await api(setup?'/admin/setup':'/admin/login',{method:'POST',body:JSON.stringify({username:$('#username').value,password:$('#password').value,remember:$('#remember').checked})});await acceptSession(r.data);}
  catch(error){if(error.status===409)await loadAuth();throw error;}
});});
$('#key-login-form').addEventListener('submit',e=>{e.preventDefault();busy(e.currentTarget,async()=>{
  try{const r=await api('/admin/login',{method:'POST',body:JSON.stringify({token:$('#token').value})});await acceptSession(r.data,'settings');}
  catch(error){if(error.status===401)error.message=t('keyError');throw error;}
});});
$('#account-form').addEventListener('submit',e=>{e.preventDefault();busy(e.currentTarget,async()=>{
  if($('#new-password').value!==$('#new-password-confirm').value)throw new Error(t('passwordMismatch'));
  const r=await api('/admin/account',{method:'PUT',body:JSON.stringify({username:$('#account-username').value,currentPassword:$('#current-password').value,password:$('#new-password').value})});
  await acceptSession(r.data,'settings');message(t('accountSaved'));
});});
$('#logout').addEventListener('click',()=>busy($('#logout'),async()=>{await api('/admin/logout',{method:'POST',body:'{}'});showLogin();await loadAuth();message('');}));
function duration(n){if(n<60)return `${n}s`;if(n<3600)return `${Math.floor(n/60)}m ${n%60}s`;return `${Math.floor(n/3600)}h ${Math.floor(n%3600/60)}m`;}
function renderStatus(){
  const s=statusData,ok=s.db&&s.migration&&!s.draining;
  $('#server-state').textContent=t(!serverConnected?'disconnected':ok?'ready':'attention');$('#endpoint').textContent=location.origin;
  $('#status-badge').textContent=t(serverConnected?'connected':'disconnected');$('#status-badge').className='pill '+(serverConnected?'good':'bad');
  $('#uptime').textContent=duration(s.uptimeSec);$('#memory').textContent=`${s.rssMB} MB`;$('#db-state').textContent=t(ok?'ok':'attention');
  $('#route-count').textContent=s.controllers.reduce((n,c)=>n+c.routes.length,0);$('#module-summary').textContent=`${s.services.length} ${t('service')} · ${s.queries.length} ${t('query')}`;
  $('#runtime').textContent=`v${s.version} · Node ${s.node}`;
  replaceChildren($('#module-list'),s.controllers.map(c=>{const row=document.createElement('tr');for(const value of[c.name,c.basePath,String(c.routes.length)]){const cell=document.createElement('td');cell.textContent=value;row.append(cell);}return row;}));
}
function renderSettings(){
  const data=settingsData,values=Object.assign({},data.effective,data.saved);
  for(const name of['workspace','host','port','https','certFile','keyFile','language','logLevel','consoleAccess']){
    const el=$(`[name="${name}"]`),locked=data.locked.includes(name);const value=locked?data.effective[name]:values[name];
    if(name==='https')el.checked=Boolean(value);else el.value=value==null?'':value;el.disabled=locked;
  }
  $('#locked-hint').hidden=!data.locked.length;$('#restart').hidden=!data.restartRequired;
}
async function loadSettings(){const form=$('#settings-form'),button=form.querySelector('button[type=submit]');button.disabled=true;form.setAttribute('aria-busy','true');try{settingsData=(await api('/admin/settings')).data;renderSettings();accountData=(await api('/admin/account')).data;$('#account-username').value=accountData.username||'admin';const needsCurrent=accountData.configured&&accountData.loginMethod==='password';$('#current-password-row').hidden=!needsCurrent;$('#current-password').required=needsCurrent;renderAuth();}finally{button.disabled=false;form.removeAttribute('aria-busy');}}
$('#settings-form').addEventListener('submit',e=>{e.preventDefault();busy(e.currentTarget,async()=>{
  const value={};for(const name of['workspace','host','port','https','certFile','keyFile','language','logLevel','consoleAccess']){const el=$(`[name="${name}"]`);if(!el.disabled)value[name]=name==='https'?el.checked:name==='port'?Number(el.value):el.value;}
  settingsData=(await api('/admin/settings',{method:'PUT',body:JSON.stringify(value)})).data;renderSettings();message(t(settingsData.restartRequired?'restart':'saved'));
});});
function renderNotes(){
  document.querySelector('[data-i18n="sampleHelp"]').textContent=t(noteCreate?'sampleHelp':'sampleReadOnly');
  const container=$('#note-list');replaceChildren(container,[]);
  if(!notes.length){const p=document.createElement('div');p.className='empty';p.textContent=t('empty');container.append(p);return;}
  for(const n of notes){
    const row=document.createElement('article');row.className='note';const text=document.createElement('div');
    const h=document.createElement('h3');h.textContent=n.title;const p=document.createElement('p');p.textContent=n.body||'';const meta=document.createElement('small');meta.textContent=`#${n.id} · ${n.created_at} UTC`;text.append(h,p,meta);
    const del=document.createElement('button');del.className='secondary';del.textContent=t('delete');del.addEventListener('click',()=>{deleteId=n.id;$('#delete-name').textContent=n.title;$('#delete-dialog').showModal();});
    const edit=document.createElement('button');edit.className='secondary';edit.textContent=t('edit');edit.addEventListener('click',()=>busy(edit,async()=>{const current=(await api(`/api/notes/${n.id}`)).data;editId=current.id;$('#edit-note-title').value=current.title;$('#edit-note-body').value=current.body??'';$('#edit-dialog').showModal();}));
    const actions=document.createElement('div');actions.className='dialog-actions';
    row.append(text);if(noteUpdate)actions.append(edit);if(noteDelete)actions.append(del);row.append(actions);container.append(row);
  }
}
async function loadNotes(){notes=(await api('/api/notes')).data;renderNotes();}
$('#note-form').addEventListener('submit',e=>{e.preventDefault();busy(e.currentTarget,async()=>{const title=$('#note-title').value.trim();if(!title)throw new Error(t('invalid'));await api('/api/notes',{method:'POST',body:JSON.stringify({title,body:$('#note-body').value||null})});e.target.reset();await loadNotes();message(t('added'));});});
$('#cancel-delete').onclick=()=>$('#delete-dialog').close();
$('#cancel-edit').onclick=()=>$('#edit-dialog').close();
$('#edit-dialog').addEventListener('close',()=>{editId=null;$('#edit-note-form').reset();});
$('#edit-note-form').addEventListener('submit',e=>{e.preventDefault();busy(e.currentTarget,async()=>{if(editId===null)return;const title=$('#edit-note-title').value.trim();if(!title)throw new Error(t('invalid'));const result=await api(`/api/notes/${editId}`,{method:'PUT',body:JSON.stringify({title,body:$('#edit-note-body').value||null})});if(result.data.rowsAffected===0)throw new Error(t('missingNote'));$('#edit-dialog').close();await loadNotes();message(t('updated'));});});
$('#confirm-delete').onclick=()=>busy($('#confirm-delete'),async()=>{if(deleteId===null)return;await api(`/api/notes/${deleteId}`,{method:'DELETE'});$('#delete-dialog').close();deleteId=null;await loadNotes();message(t('deleted'));});
document.querySelectorAll('[data-tab]').forEach(button=>button.addEventListener('click',async()=>{
  activeTab=button.dataset.tab;document.querySelectorAll('[data-tab]').forEach(el=>el.classList.toggle('active',el===button));document.querySelectorAll('.panel').forEach(el=>el.hidden=el.id!==activeTab);message('');
  try{await toolsUI.open(activeTab);await robotUI.open(activeTab==='robot');if(activeTab==='settings')await loadSettings();else if(activeTab==='notes')await loadNotes();}catch(e){if(!e.stale)message(e.message,true);}
}));
function openStream(){
  if(!signedIn||document.hidden||stream||performance.now()<nextStreamAt||typeof EventSource!=='function')return;
  const current=generation,source=new EventSource('/admin/events');stream=source;
  const valid=()=>signedIn&&current===generation&&stream===source;
  source.addEventListener('status',event=>{
    if(!valid())return;let value;try{value=JSON.parse(event.data);}catch{return;}
    if(typeof value.version!=='string'||typeof value.db!=='boolean')return;
    streamAt=performance.now();serverConnected=true;liveMode='live';$('#live-state').textContent=t(liveMode);
    if(statusData){statusData=Object.assign({},statusData,value);renderStatus();}
  });
  source.addEventListener('reset',()=>{if(valid())refresh(false);});
  source.onerror=()=>{
    if(!valid())return;serverConnected=false;streamAt=0;nextStreamAt=performance.now()+3000;liveMode='polling';$('#live-state').textContent=t(liveMode);if(statusData)renderStatus();
    if(source.readyState===2){source.close();stream=null;}
    refresh(false);
  };
}
async function refresh(details=true){
  if(refreshing===generation||!signedIn)return;const current=generation;refreshing=current;
  try{
    statusData=(await api('/admin/status')).data;serverConnected=true;renderStatus();
    if(!featuresLoaded){const features=(await api('/admin/features')).data;noteCreate=features.noteCreate!==false;noteDelete=features.noteDelete!==false;noteUpdate=features.noteUpdate===true;$('#note-form').hidden=!noteCreate;$('#robot-tab').hidden=!features.robot;document.querySelector('[data-tab="notes"]').hidden=features.notes===false;if(activeTab==='notes'&&features.notes===false)selectTab('overview');featuresLoaded=true;
      if(activeTab==='robot'&&!features.robot){activeTab='overview';document.querySelectorAll('[data-tab]').forEach(el=>el.classList.toggle('active',el.dataset.tab===activeTab));document.querySelectorAll('.panel').forEach(el=>el.hidden=el.id!==activeTab);}
    }
    openStream();if(details){await toolsUI.refresh();if(activeTab==='settings')await loadSettings();if(activeTab==='notes')await loadNotes();if(activeTab==='robot')await robotUI.open(true);}
  }
  catch(e){if(!e.stale){serverConnected=false;$('#server-state').textContent=t('disconnected');$('#status-badge').textContent=t('disconnected');$('#status-badge').className='pill bad';message(e.message,true);}}
  finally{if(refreshing===current)refreshing=null;}
}
$('#refresh').onclick=()=>refresh();
translate();
try{const preferences=(await api('/admin/preferences')).data;if(preferences.version)$('#app-version').textContent='v'+preferences.version;if(!explicitLanguage&&words[preferences.language]){language=preferences.language;translate();}}catch(e){}
try{await loadAuth();}catch(e){message(e.message,true);}
try{const session=await api('/admin/session');await acceptSession(session.data,session.data.configured?'overview':'settings');}catch(e){showLogin();}
document.documentElement.dataset.consoleReady='true';
setInterval(()=>{if(!document.hidden&&signedIn&&(!streamAt||performance.now()-streamAt>25000))refresh(false);},10000);
document.addEventListener('visibilitychange',()=>{if(document.hidden)closeStream();else if(signedIn){refresh(false);robotUI.refresh();}});
window.addEventListener('pagehide',()=>closeStream());

})();
