(function(){
'use strict';
const text={
ko:{robot:'로봇',title:'로봇 연결',intro:'관제 연결과 로봇 내부 상태를 각각 확인합니다.',demo:'ROBATON 데모 연결',controller:'관제 서버',bridge:'ROS 연결',pose:'위치 정보',battery:'배터리',connected:'연결됨',disconnected:'연결 안 됨',fresh:'최신 정보',stale:'확인 필요',unknown:'미수신',seconds:'초 전',check:'연결 진단',pause:'일시 보류',resume:'보류 해제',phase:'오더 상태',waypoint:'진행 지점',noOrder:'진행 중인 오더가 없습니다.',setup:'연결 설정 필요',waiting:'연결 대기',idle:'오더 대기',queued:'순서 대기',dispatching:'이동 요청 중',executing:'이동 중',held:'보류 중',fault:'확인 필요','reporting-completion':'완료 보고 중',cancelPending:'취소 결과 확인 중',checks:'연동 점검',navigation:'이동 Action 서버',recovery:'오더 복구 상태',ok:'정상',attention:'확인 필요',frame:'지도 좌표계',topics:'ROS 인터페이스',settings:'관제 연결 설정',settingsHelp:'저장한 연결 설정은 서버를 다시 시작하면 적용됩니다.',enabled:'관제 연결 사용',enabledHelp:'켜고 다시 시작하면 이 단말이 관제 서버에 연결됩니다.',robotId:'로봇 ID',url:'관제 서버 주소',bridgeUrl:'이 기기의 ROS 연결 주소',token:'관제 인증 키',tokenSaved:'저장됨 · 바꾸려면 새 키를 입력하세요',tokenEmpty:'발급된 인증 키를 입력하세요',tokenHelp:'저장한 키는 화면이나 진단 결과에 표시하지 않습니다.',save:'연결 설정 저장',saved:'설정을 저장했습니다. 서버를 다시 시작하면 적용됩니다.',restart:'저장한 설정을 적용하려면 서버를 다시 시작하세요.',managed:'비활성화된 항목은 실행 환경에서 관리합니다.',orderBlocks:'진행 중인 오더를 정리한 뒤 연결 설정을 변경할 수 있습니다.',holdNotice:'보류 상태입니다. 로봇과 관제 상태를 확인한 뒤 해제하세요.',remoteHold:'관제에서 보류했거나 공유 구역 확인이 필요합니다.',recoveryNotice:'이전 오더의 결과를 확인해야 합니다. 로봇의 실제 정지 상태와 관제 기록을 확인하세요.',diagnosed:'연결 진단을 완료했습니다.',pauseRequested:'보류를 요청했습니다. 이동 중이었다면 취소 결과를 확인하세요.',resumed:'보류를 해제했습니다.',resumeTitle:'보류를 해제할까요?',resumeHelp:'미완료 오더가 있으면 이동을 다시 시도할 수 있습니다.',confirmStopped:'로봇이 정지했고 관제의 보류가 해제된 것을 확인했습니다.',cancel:'취소',export:'진단 JSON 보기',unavailable:'현재 상태를 확인하지 못했습니다.',errorSettings:'연결 설정을 확인하세요.',conflict:'다른 화면에서 설정이 변경되었습니다. 설정을 다시 열어 확인하세요.',notReady:'관제 연결, ROS 상태와 실제 정지 여부를 확인하세요.',managedError:'실행 환경에서 관리하는 항목은 여기서 바꿀 수 없습니다.',checkpointError:'오더 기록을 확인해야 합니다. 복구 전에는 이동을 재개할 수 없습니다.',tlsError:'다른 장치의 관제 서버에는 HTTPS 주소를 사용하세요.',localError:'ROS 연결 주소는 이 기기의 localhost 주소여야 합니다.'},
en:{robot:'Robot',title:'Robot connection',intro:'Check the fleet connection and the robot independently.',demo:'ROBATON demo connection',controller:'Fleet server',bridge:'ROS connection',pose:'Localization',battery:'Battery',connected:'Connected',disconnected:'Disconnected',fresh:'Fresh',stale:'Check required',unknown:'Not received',seconds:'s ago',check:'Run diagnostics',pause:'Hold orders',resume:'Release hold',phase:'Order status',waypoint:'Waypoint',noOrder:'No order in progress.',setup:'Setup required',waiting:'Waiting for connection',idle:'Waiting for orders',queued:'Queued',dispatching:'Requesting navigation',executing:'Navigating',held:'On hold',fault:'Check required','reporting-completion':'Reporting completion',cancelPending:'Waiting for cancellation result',checks:'Integration checks',navigation:'Navigation Action server',recovery:'Order recovery',ok:'Ready',attention:'Check required',frame:'Map frame',topics:'ROS interfaces',settings:'Fleet connection settings',settingsHelp:'Saved connection settings take effect after restarting the server.',enabled:'Enable fleet connection',enabledHelp:'When enabled, this device connects to the fleet server after restart.',robotId:'Robot ID',url:'Fleet server address',bridgeUrl:'ROS address on this device',token:'Fleet access key',tokenSaved:'Saved · enter a new key to replace it',tokenEmpty:'Enter the issued access key',tokenHelp:'Saved keys are never displayed or included in diagnostics.',save:'Save connection settings',saved:'Settings saved. Restart the server to apply them.',restart:'Restart the server to apply the saved settings.',managed:'Disabled fields are managed by the execution environment.',orderBlocks:'Resolve the current order before changing connection settings.',holdNotice:'Orders are on hold. Check the robot and fleet state before releasing the hold.',remoteHold:'The fleet has a hold or a shared area needs review.',recoveryNotice:'A previous order needs reconciliation. Confirm the robot has stopped and review the fleet record.',diagnosed:'Diagnostics complete.',pauseRequested:'Hold requested. If navigation was active, check its cancellation result.',resumed:'Hold released.',resumeTitle:'Release the hold?',resumeHelp:'An unfinished order may attempt navigation again.',confirmStopped:'I confirmed the robot has stopped and the fleet hold is cleared.',cancel:'Cancel',export:'View diagnostic JSON',unavailable:'The current state could not be verified.',errorSettings:'Check the connection settings.',conflict:'Settings changed in another window. Reopen the settings before saving.',notReady:'Check the fleet connection, ROS readiness and actual robot stop.',managedError:'Environment-managed values cannot be changed here.',checkpointError:'The order record needs reconciliation before navigation can resume.',tlsError:'Use HTTPS for a fleet server on another device.',localError:'The ROS bridge must use a localhost address on this device.'}
};
window.AidotRobotConsole={mount:function(host){
 const $=s=>document.querySelector(s),section=$('#robot');
 let active=false,signedIn=false,state=null,settings=null,pending=false,observed=0,lastPoll=0,epoch=0;
 const t=k=>(text[host.language()]||text.ko)[k]||k;
 section.innerHTML='<div class="card-heading"><div><h2 data-rtext="title"></h2><p class="muted" data-rtext="intro"></p></div><span class="pill" data-rtext="demo"></span></div>'+
 '<div id="robot-notice" class="notice" hidden></div><div class="metrics robot-metrics">'+['controller','bridge','pose','battery'].map(k=>'<div class="card"><span data-rtext="'+k+'"></span><strong id="robot-'+k+'">—</strong><small id="robot-'+k+'-age" class="muted"></small></div>').join('')+'</div>'+
 '<div class="card"><div class="card-heading"><div><span data-rtext="phase"></span><h2 id="robot-phase">—</h2><p id="robot-order" class="muted"></p></div></div><div class="robot-actions"><button id="robot-check" class="secondary" data-rtext="check"></button><button id="robot-pause" class="secondary" data-rtext="pause"></button><button id="robot-resume" data-rtext="resume"></button></div></div>'+
 '<div class="card"><h2 data-rtext="checks"></h2><dl id="robot-check-list" class="robot-check-list"></dl><p class="hint" id="robot-frame"></p><details><summary data-rtext="topics"></summary><pre id="robot-runtime"></pre></details><button id="robot-export" class="secondary" data-rtext="export"></button></div>'+
 '<form id="robot-settings-form" class="card"><h2 data-rtext="settings"></h2><p class="muted" data-rtext="settingsHelp"></p><div id="robot-restart" class="notice" hidden data-rtext="restart"></div><div id="robot-settings-blocked" class="notice" hidden data-rtext="orderBlocks"></div>'+
 '<label class="switch-line"><input id="robot-enabled" name="enabled" type="checkbox"><span><b data-rtext="enabled"></b><small data-rtext="enabledHelp"></small></span></label>'+
 '<div class="form-grid"><div><label for="robot-id" data-rtext="robotId"></label><select id="robot-id" name="robotId"><option value="amr-a">amr-a</option><option value="amr-b">amr-b</option></select></div><div><label for="robot-url" data-rtext="url"></label><input id="robot-url" name="controllerUrl" type="url" maxlength="512" placeholder="https://fleet.example.internal"></div></div>'+
 '<label for="robot-bridge-url" data-rtext="bridgeUrl"></label><input id="robot-bridge-url" name="bridgeUrl" type="url" maxlength="512" required><label for="robot-key" data-rtext="token" class="robot-key-label"></label><input id="robot-key" name="apiToken" type="password" autocomplete="new-password" maxlength="256"><p class="hint" data-rtext="tokenHelp"></p><p id="robot-managed" class="hint" hidden data-rtext="managed"></p><div class="form-footer"><button type="submit" data-rtext="save"></button></div></form>'+
 '<dialog id="robot-export-dialog"><h2 data-rtext="export"></h2><textarea id="robot-export-json" readonly rows="12" aria-label="Diagnostic JSON"></textarea><div class="dialog-actions"><button id="robot-export-close" data-rtext="cancel"></button></div></dialog>'+
 '<dialog id="robot-resume-dialog"><h2 data-rtext="resumeTitle"></h2><p data-rtext="resumeHelp"></p><label class="switch-line"><input id="robot-confirm-stopped" type="checkbox"><span data-rtext="confirmStopped"></span></label><div class="dialog-actions"><button id="robot-cancel-resume" class="secondary" data-rtext="cancel"></button><button id="robot-confirm-resume" data-rtext="resume" disabled></button></div></dialog>';
 function errorMessage(error){
  const code=error.reasonCode||'';
  if(code==='ROBOT_SETTINGS_CONFLICT')return t('conflict');
  if(code==='HTTPS_REQUIRED')return t('tlsError');
  if(code==='LOCAL_BRIDGE_REQUIRED')return t('localError');
  if(code==='ROBOT_SETTING_MANAGED')return t('managedError');
  if(code==='RESUME_NOT_READY'||code==='STOP_CONFIRMATION_REQUIRED')return t('notReady');
  if(/CHECKPOINT|RECONCILIATION|UNFINISHED/.test(code))return t('checkpointError');
  if(/SETTINGS_BLOCKED/.test(code))return t('orderBlocks');
  return code?t('errorSettings'):error.message;
 }
 function translate(){section.querySelectorAll('[data-rtext]').forEach(el=>el.textContent=t(el.dataset.rtext));if(settings)$('#robot-key').placeholder=t(settings.saved.tokenConfigured?'tokenSaved':'tokenEmpty');render();}
 const elapsedAge=number=>Number.isFinite(number)?number+Math.max(0,performance.now()-observed):null;
 const ageText=value=>value===null?'':(value/1000).toFixed(1)+' '+t('seconds');
 function render(){
  const b=state&&state.bridge,c=state&&state.controller,expired=!state||performance.now()-observed>5000;
  const poseAge=elapsedAge(b&&b.poseAgeMs),batteryAge=elapsedAge(b&&b.batteryAgeMs),controllerAge=elapsedAge(c&&c.ageMs);
  const connected=!!c&&c.connected&&!expired&&controllerAge!==null&&controllerAge<=3000;
  $('#robot-controller').textContent=t(connected?'connected':'disconnected');$('#robot-controller-age').textContent=ageText(controllerAge);
  $('#robot-bridge').textContent=t(b&&b.connected&&!expired?'connected':'disconnected');
  $('#robot-pose').textContent=t(!b||!b.pose?'unknown':!expired&&poseAge!==null&&poseAge<=1500?'fresh':'stale');$('#robot-pose-age').textContent=ageText(poseAge);
  $('#robot-battery').textContent=b&&Number.isFinite(b.battery)&&!expired&&batteryAge!==null&&batteryAge<=10000?Math.round(b.battery)+'%':'—';$('#robot-battery-age').textContent=ageText(batteryAge);
  $('#robot-phase').textContent=t(expired?'unavailable':b&&b.active==='CANCEL_REQUESTED'?'cancelPending':state.phase);
  $('#robot-order').textContent=state&&state.order?state.order.id+' · '+t('waypoint')+' '+state.order.waypoint:t('noOrder');
  $('#robot-pause').disabled=expired||!state.configured;$('#robot-resume').disabled=expired||!state.canResume||!connected;
  const notice=$('#robot-notice');let noticeText='';
  if(state){if(b&&(b.recoveryRequired||b.storageFault))noticeText=t('recoveryNotice');else if(state.remoteHeld)noticeText=t('remoteHold');else if(state.hold)noticeText=t('holdNotice');else if(state.setupError||state.error)noticeText=t('unavailable');}
  notice.textContent=noticeText;notice.hidden=!noticeText;
  const list=$('#robot-check-list');while(list.firstChild)list.removeChild(list.firstChild);
  (state?state.checks:[]).forEach(check=>{
    const row=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=t(check.id);
    let ok=check.ok&&!expired;if(check.id==='pose')ok=ok&&poseAge!==null&&poseAge<=1500;if(check.id==='battery')ok=ok&&batteryAge!==null&&batteryAge<=10000;
    dd.textContent=t(ok?'ok':'attention');dd.className='pill '+(ok?'good':'bad');row.append(dt,dd);list.append(row);
  });
  $('#robot-frame').textContent=t('frame')+': '+(b&&b.frameId||'—');$('#robot-runtime').textContent=b&&b.runtime?JSON.stringify(b.runtime,null,2):'—';
  $('#robot-settings-blocked').hidden=!state||state.settingsEditable;
  const save=$('#robot-settings-form button[type=submit]');save.disabled=!settings||!!state&&!state.settingsEditable;
 }
 async function poll(force){
  if(!signedIn||!active||document.hidden||pending||!force&&performance.now()-lastPoll<900)return;
  pending=true;lastPoll=performance.now();const current=epoch;
  try{const reply=await host.api('/admin/robot');if(current!==epoch)return;state=reply.data;observed=performance.now();render();}
  catch(error){if(current===epoch){state=null;render();if(!error.stale)host.message(error.message,true);}}
  finally{pending=false;}
 }
 async function loadSettings(){
  const current=epoch,reply=await host.api('/admin/robot/settings');if(current!==epoch)return;settings=reply.data;
  ['enabled','robotId','controllerUrl','bridgeUrl'].forEach(key=>{const el=$('#robot-settings-form [name='+key+']');if(key==='enabled')el.checked=settings.saved[key];else el.value=settings.saved[key];el.disabled=settings.locked.includes(key);});
  $('#robot-key').value='';$('#robot-key').disabled=settings.locked.includes('apiToken');$('#robot-key').placeholder=t(settings.saved.tokenConfigured?'tokenSaved':'tokenEmpty');
  $('#robot-managed').hidden=!settings.locked.length;$('#robot-restart').hidden=!settings.restartRequired;render();
 }
 async function action(button,fn){button.disabled=true;try{await fn();}catch(error){if(!error.stale)host.message(errorMessage(error),true);}finally{render();button.disabled=false;if(button.id!=='robot-check')render();}}
 $('#robot-settings-form').addEventListener('submit',event=>{event.preventDefault();action(event.currentTarget.querySelector('button'),async()=>{
  if(!settings)return;const values={};['enabled','robotId','controllerUrl','bridgeUrl','apiToken'].forEach(key=>{const el=$('#robot-settings-form [name='+key+']');if(!el.disabled&&(key!=='apiToken'||el.value))values[key]=key==='enabled'?el.checked:el.value;});
  await host.api('/admin/robot/settings',{method:'PUT',body:JSON.stringify({revision:settings.revision,values:values})});$('#robot-key').value='';await loadSettings();host.message(t('saved'));
 });});
 $('#robot-check').onclick=()=>action($('#robot-check'),async()=>{state=(await host.api('/admin/robot/diagnostics',{method:'POST',body:'{}'})).data;observed=performance.now();render();host.message(t('diagnosed'));});
 $('#robot-pause').onclick=()=>action($('#robot-pause'),async()=>{state=(await host.api('/admin/robot/pause',{method:'POST',body:'{}'})).data;observed=performance.now();host.message(t('pauseRequested'));});
 $('#robot-resume').onclick=()=>{$('#robot-confirm-stopped').checked=false;$('#robot-confirm-resume').disabled=true;$('#robot-resume-dialog').showModal();};
 $('#robot-confirm-stopped').onchange=()=>$('#robot-confirm-resume').disabled=!$('#robot-confirm-stopped').checked;
 $('#robot-cancel-resume').onclick=()=>$('#robot-resume-dialog').close();
 $('#robot-confirm-resume').onclick=()=>action($('#robot-confirm-resume'),async()=>{if(!$('#robot-confirm-stopped').checked)return;state=(await host.api('/admin/robot/resume',{method:'POST',body:JSON.stringify({confirmStopped:true})})).data;observed=performance.now();$('#robot-resume-dialog').close();host.message(t('resumed'));});
 $('#robot-export').onclick=()=>{if(!state)return;$('#robot-export-json').value=JSON.stringify({format:'aidot-robot-diagnostics/v1',capturedAt:new Date().toISOString(),snapshotAgeMs:Math.round(performance.now()-observed),snapshotFresh:performance.now()-observed<=5000,state:state},null,2);$('#robot-export-dialog').showModal();};
 $('#robot-export-close').onclick=()=>$('#robot-export-dialog').close();
 const timer=setInterval(()=>{if(signedIn&&active&&!document.hidden){render();poll(false);}},1000);
 translate();
 return {translate:translate,session:function(value){epoch++;signedIn=value;state=null;settings=null;$('#robot-key').value='';if(!value){if($('#robot-resume-dialog').open)$('#robot-resume-dialog').close();if($('#robot-export-dialog').open)$('#robot-export-dialog').close();$('#robot-export-json').value='';}render();},open:async function(value){active=value;if(value){await loadSettings();await poll(true);}},refresh:()=>poll(true),close:()=>clearInterval(timer)};
}};
})();
