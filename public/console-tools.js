/* Copyright 2026 Aidot Link Co., Ltd. SPDX-License-Identifier: Apache-2.0 */
window.AidotConsoleTools = { mount({api, language, message}) {
  const $ = s => document.querySelector(s);
  const text = {
    en: {files:'Workspace files',logs:'Log files',filesHelp:'Edit controller, service and SQL source in the active workspace.',choose:'Choose a file',reload:'Reload from disk',save:'Validate and save',restart:'Saved. Restart the server to apply. Development mode restarts automatically.',readonly:'Read-only: generated metadata, applied migration, or filesystem permission.',syntax:'JavaScript syntax and named SQL structure are checked. Test the API after restarting.',dirty:'Unsaved changes',discard:'Discard unsaved changes and reload?',empty:'No files found.',limit:'Only the first 2,000 directory entries are listed.',logHelp:'Read the recent part of the server log. Filters apply within the last 128 KiB.',refresh:'Refresh logs',search:'Search text',level:'Level',all:'All levels',follow:'Refresh every 5 seconds while this tab is visible',partial:'Showing a limited recent window.',noLogs:'No log files. Enable LOG_TO_FILE to record server logs.',noMatches:'No matching lines in the recent window.',saved:'Saved',unchanged:'No changes to save',lines:'lines',loaded:'Loaded from disk',fileLimit:'Files above 64 KiB must be edited outside the console.'},
    ko: {files:'Workspace 파일',logs:'로그 파일',filesHelp:'실행 중인 workspace의 Controller·Service·SQL 소스를 편집합니다.',choose:'파일을 선택하세요',reload:'파일 다시 읽기',save:'검사 후 저장',restart:'저장했습니다. 서버를 재시작하면 반영됩니다. 개발 모드는 자동 재시작합니다.',readonly:'읽기 전용: 자동 생성 meta, 적용된 migration 또는 파일 쓰기 권한이 없는 경우입니다.',syntax:'JavaScript 문법과 SQL 이름 구조를 검사합니다. 재시작 후 API를 실행 검증하세요.',dirty:'저장하지 않은 변경',discard:'저장하지 않은 변경을 버리고 다시 읽을까요?',empty:'파일이 없습니다.',limit:'최대 2,000개 디렉터리 항목까지만 조회합니다.',logHelp:'서버 로그의 최근 부분을 읽습니다. 필터는 최근 128 KiB 범위에 적용됩니다.',refresh:'로그 새로고침',search:'내용 검색',level:'로그 수준',all:'모든 수준',follow:'이 탭이 보이는 동안 5초마다 갱신',partial:'최근 일부 범위를 표시합니다.',noLogs:'로그 파일이 없습니다. LOG_TO_FILE을 켜면 서버 로그가 기록됩니다.',noMatches:'최근 범위에 일치하는 로그가 없습니다.',saved:'저장 완료',unchanged:'변경한 내용이 없습니다',lines:'줄',loaded:'파일을 읽었습니다',fileLimit:'64 KiB가 넘는 파일은 외부 편집기를 사용하세요.'}
  };
  const t = key => text[language() === 'ko' ? 'ko' : 'en'][key] || key;
  let file = null, fileList = [], enabled = false, tab = '', epoch = 0, logTimer, logBusy = false;
  let fileStatus = '', logPartial = false;
  const dirty = () => file && $('#source-code').value !== file.content;
  const fail = error => { if (!error.stale) message(error.serverMessage || error.message, true); };
  function translate() {
    document.querySelectorAll('[data-tools-text]').forEach(el => el.textContent = t(el.dataset.toolsText));
    $('#source-state').textContent = dirty() ? t('dirty') : fileStatus ? t(fileStatus) : '';
    $('#source-readonly').textContent = file && !file.writable ? t('readonly') : t('syntax');
    $('#log-range').textContent = logPartial ? t('partial') : '';
  }
  function clear() {
    epoch++; file = null; fileList = []; fileStatus = ''; logPartial = false;
    $('#source-code').value = ''; $('#source-path').textContent = ''; $('#source-list').replaceChildren();
    $('#log-output').textContent = ''; $('#log-file').replaceChildren(); $('#source-save').disabled = true;
    $('#source-code').readOnly = true; $('#source-restart').hidden = true; $('#log-follow').checked = false; clearInterval(logTimer);
  }
  async function read(name) {
    if (dirty() && !window.confirm(t('discard'))) return;
    const current = ++epoch;
    try {
      const data = (await api('/admin/workspace/file?path=' + encodeURIComponent(name))).data;
      if (!enabled || current !== epoch) return;
      file = data; fileStatus = 'loaded'; $('#source-code').value = data.content;
      $('#source-code').readOnly = !data.writable; $('#source-save').disabled = !data.writable;
      $('#source-path').removeAttribute('data-tools-text'); $('#source-path').textContent = data.path; $('#source-lines').textContent = data.content.split('\n').length + ' ' + t('lines');
      $('#source-list').querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.path === name));
      translate();
    } catch (error) { fail(error); }
  }
  async function files() {
    const current = epoch, data = (await api('/admin/workspace/files')).data;
    if (!enabled || current !== epoch) return;
    fileList = data.files;
    $('#source-list').replaceChildren();
    for (const item of fileList) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'source-file secondary';
      button.textContent = item.path; button.dataset.path = item.path; button.disabled = item.tooLarge;
      button.title = item.tooLarge ? t('fileLimit') : item.writable ? item.path : t('readonly');
      button.classList.toggle('active', file?.path === item.path); button.onclick = () => read(item.path);
      $('#source-list').append(button);
    }
    $('#source-list-info').textContent = data.truncated ? t('limit') : !fileList.length ? t('empty') : '';
    $('#source-restart').hidden = !data.restartRequired; translate();
  }
  async function logs(list = false) {
    if (!enabled || tab !== 'logs' || document.hidden || logBusy) return;
    logBusy = true;
    const current = epoch;
    try {
      if (list || !$('#log-file').value) {
        const data = (await api('/admin/logs/files')).data;
        if (!enabled || current !== epoch) return;
        const selected = $('#log-file').value;
        $('#log-file').replaceChildren();
        for (const item of data.files) {
          const option = document.createElement('option'); option.value = item.name; option.textContent = item.name + ' (' + item.bytes + ' B)'; $('#log-file').append(option);
        }
        if (data.files.some(f => f.name === selected)) $('#log-file').value = selected;
        if (!data.files.length) { $('#log-output').textContent = t('noLogs'); return; }
      }
      const query = new URLSearchParams({file: $('#log-file').value, level: $('#log-level').value, search: $('#log-search').value, lines: '300'});
      const data = (await api('/admin/logs/tail?' + query)).data;
      if (!enabled || current !== epoch || tab !== 'logs') return;
      $('#log-output').textContent = data.lines.join('\n') || t('noMatches');
      logPartial = data.truncated; $('#log-range').textContent = logPartial ? t('partial') : '';
      if ($('#log-follow').checked) $('#log-output').scrollTop = $('#log-output').scrollHeight;
    } catch (error) { fail(error); } finally { logBusy = false; }
  }
  $('#source-code').addEventListener('input', () => { translate(); $('#source-lines').textContent = $('#source-code').value.split('\n').length + ' ' + t('lines'); });
  $('#source-code').addEventListener('keydown', event => {
    if (event.key === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey && !event.currentTarget.readOnly) {
      event.preventDefault(); const el = event.currentTarget; el.setRangeText('  ', el.selectionStart, el.selectionEnd, 'end'); el.dispatchEvent(new Event('input'));
    }
  });
  $('#source-reload').onclick = () => file ? read(file.path) : files().catch(fail);
  $('#source-save').onclick = async () => {
    if (!file?.writable) return;
    const button = $('#source-save'); button.disabled = true;
    // Ignore a save response if another file or session has become active.
    const selected = file, content = $('#source-code').value, current = epoch;
    try {
      const data = (await api('/admin/workspace/file', {method: 'PUT', body: JSON.stringify({path: selected.path, content, revision: selected.revision, workspaceId: selected.workspaceId})})).data;
      if (!enabled || current !== epoch || file !== selected) return;
      file = {...selected, revision: data.revision, content}; fileStatus = data.unchanged ? 'unchanged' : 'saved'; $('#source-restart').hidden = !data.restartRequired; translate(); message(t(data.restartRequired ? 'restart' : fileStatus));
    } catch (error) { fail(error); } finally { button.disabled = !file?.writable; }
  };
  $('#log-filter').onsubmit = event => { event.preventDefault(); logs(true); };
  $('#log-file').onchange = () => logs(); $('#log-level').onchange = () => logs();
  $('#log-follow').onchange = () => { clearInterval(logTimer); if ($('#log-follow').checked) { logs(); logTimer = setInterval(() => logs(), 5000); } };
  window.addEventListener('beforeunload', event => { if (dirty()) { event.preventDefault(); event.returnValue = ''; } });
  window.addEventListener('pagehide', () => clearInterval(logTimer));
  translate();
  return {
    translate,
    session(value) { enabled = value; if (!value) clear(); },
    async open(name) { tab = name; if (name === 'files') await files(); if (name === 'logs') await logs(true); },
    async refresh() { if (tab === 'files') await files(); if (tab === 'logs') await logs(true); }
  };
} };
