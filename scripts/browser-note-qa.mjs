import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fork} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const root=path.resolve(process.env.QA_PROJECT_ROOT||path.join(path.dirname(fileURLToPath(import.meta.url)),'..'));
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'aidot-note-browser-')),out=path.resolve(process.env.BROWSER_QA_OUTPUT||path.join(root,'validation/note-generated/browser'));
fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(tmp,'empty.env'),'');
const workspace=path.join(tmp,'외부 Note workspace');fs.cpSync(path.join(root,'examples/note-auth-workspace'),workspace,{recursive:true});
const primaryWorkspace=path.join(tmp,'public-workspace');fs.cpSync(path.join(root,'workspace'),primaryWorkspace,{recursive:true});fs.mkdirSync(path.join(tmp,'data'));fs.writeFileSync(path.join(tmp,'data/settings.json'),JSON.stringify({workspace:primaryWorkspace}));
const files=['controller/NoteController.js','controller/meta/NoteController.meta.json','service/NoteService.js','service/meta/NoteService.meta.json','sql/note.sql'];
const hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const hashes=Object.fromEntries(files.map(p=>[p,hash(path.join(workspace,p))]));
let child,base,browser,failure;const checks=[],errors=[],requests=[];
function pass(name){checks.push(name);console.log('PASS '+name);}
async function start(){
 const fd=fs.openSync(path.join(out,'server.log'),'a');
 const env={...process.env,DATA_DIR:path.join(tmp,'data'),DB_FILE:path.join(tmp,'data/app.db'),ENV_FILE:path.join(tmp,'empty.env'),PORT:'0',HOST:'127.0.0.1',HTTPS_ENABLED:'false',LOG_TO_FILE:'true',LOG_DIR:path.join(tmp,'logs'),LOG_LEVEL:'info'};
 delete env.APP_WORKSPACE;delete env.ADMIN_TOKEN;
 child=fork(path.join(root,'start.js'),[],{cwd:root,env,execArgv:[],stdio:['ignore',fd,fd,'ipc']});fs.closeSync(fd);
 await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('startup timeout')),30000);child.once('exit',c=>{clearTimeout(t);reject(new Error('server exited '+c));});child.on('message',m=>{if(m?.type==='ready'){base='http://127.0.0.1:'+m.port;clearTimeout(t);resolve();}});});
}
async function stop(){if(!child||child.exitCode!==null)return;await new Promise(resolve=>{const t=setTimeout(()=>child.kill('SIGTERM'),5000);child.once('exit',()=>{clearTimeout(t);resolve();});child.send({type:'aidot:shutdown'});});}
try{
 await start();browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE});
 const context=await browser.newContext({viewport:{width:1280,height:900},locale:'ko-KR'}),page=await context.newPage();
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/notes'))requests.push({method:r.method(),path:new URL(r.url()).pathname});});
 await page.goto(base);await page.waitForFunction(()=>document.documentElement.dataset.consoleReady==='true');
 assert.equal(await page.locator('#language').inputValue(),'en');assert.equal(await page.locator('[data-i18n="welcome"]').textContent(),'Sprint Boot style javascript web server for mobile devices, robots and drones');pass('English is the fresh default, including on a Korean browser');
 assert.ok(await page.locator('.brand-icon img').evaluate(el=>el.complete&&el.naturalWidth>0));assert.equal(await page.locator('.brand-icon img').getAttribute('alt'),'m.');await page.screenshot({path:path.join(out,'login-en-v060.png')});pass('Custom vector m. icon renders on login');
 await page.fill('#username','note-admin');await page.fill('#password','Note-Browser-2026!');await page.fill('#password-confirm','Note-Browser-2026!');await page.check('#remember');await page.click('#login-submit');await page.waitForSelector('#workspace:not([hidden])');
 assert.equal(await page.locator('#password').inputValue(),'');pass('ID/password setup and password clearing');
 await page.waitForFunction(()=>document.querySelector('#module-list').textContent.includes('NoteController'));
 assert.ok(!(await page.locator('#module-list').textContent()).includes('SnackController'));pass('Default console loads Note only');
 await page.click('[data-tab="settings"]');await page.waitForFunction(()=>!document.querySelector('#settings-form').hasAttribute('aria-busy'));assert.equal(await page.locator('#default-language').inputValue(),'en');pass('Settings default language is English');
 await page.click('[data-tab="files"]');await page.locator('.source-file[data-path="controller/NoteController.js"]').click();await page.waitForFunction(()=>!document.querySelector('#source-code').readOnly);
 const code=await page.locator('#source-code').inputValue();await page.fill('#source-code',code+'\n// Browser save verification.\n');
 const saveResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/admin/workspace/file'&&r.request().method()==='PUT');await page.click('#source-save');assert.equal((await saveResponse).status(),200);await page.waitForSelector('#source-restart:not([hidden])');
 await page.screenshot({path:path.join(out,'workspace-editor-en.png')});
 assert.match((await(await page.request.get(base+'/admin/workspace/file?path=controller%2FNoteController.js')).json()).data.content,/Browser save verification/);pass('Browser validates, saves and rereads source with CSRF session');
 await page.locator('.source-file[data-path="controller/meta/NoteController.meta.json"]').click();await page.waitForFunction(()=>document.querySelector('#source-code').readOnly);assert.equal(await page.locator('#source-save').isDisabled(),true);pass('Generated metadata is read-only in the browser');
 await page.click('[data-tab="logs"]');await page.waitForFunction(()=>document.querySelector('#log-output').textContent.includes('listening'));await page.fill('#log-search','workspace file saved');await page.click('#log-filter button[type=submit]');await page.waitForFunction(()=>document.querySelector('#log-output').textContent.includes('Console workspace file saved'));await page.screenshot({path:path.join(out,'logs-en.png')});pass('Browser reads and filters actual server log files');
 fs.appendFileSync(path.join(tmp,'logs/server.log'),new Date().toISOString()+" [ERROR] UI-XSS-probe <img src=x onerror=alert(1)>\n");await page.fill('#log-search','UI-XSS-probe');await page.click('#log-filter button[type=submit]');await page.waitForFunction(()=>document.querySelector('#log-output').textContent.includes('<img'));assert.equal(await page.locator('#log-output img').count(),0);pass('Log markup is displayed as text');
 await page.setViewportSize({width:390,height:844});await page.click('[data-tab="files"]');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.ok(await page.evaluate(()=>[...document.querySelectorAll('nav button')].filter(el=>el.offsetParent!==null).every(el=>el.scrollWidth<=el.clientWidth)));await page.screenshot({path:path.join(out,'workspace-mobile.png'),fullPage:true});await page.click('[data-tab="logs"]');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(out,'logs-mobile.png'),fullPage:true});await page.setViewportSize({width:1280,height:900});pass('Workspace and log tabs fit a 390px mobile viewport');
 await page.selectOption('#language','ko');await page.click('[data-tab="notes"]');await page.getByRole('heading',{name:'First note',exact:true}).waitFor();pass('Console lists database seed');
 await page.fill('#note-title','브라우저 메모');await page.fill('#note-body','<img src=x onerror=alert(1)>');
 const createdResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/notes'&&r.request().method()==='POST');
 await page.click('#note-form button[type=submit]');const created=await createdResponse;assert.equal(created.status(),201);
 const id=(await created.json()).data.insertId;assert.ok(id>0);await page.getByRole('heading',{name:'브라우저 메모',exact:true}).waitFor();pass('Console create returns generated insertId and reloads rows');
 let row=page.locator('article.note').filter({has:page.getByRole('heading',{name:'브라우저 메모',exact:true})});
 assert.equal(await row.locator('img').count(),0);pass('Note text is rendered safely as text');
 await row.getByRole('button',{name:'수정',exact:true}).click();await page.waitForSelector('#edit-dialog[open]');
 assert.equal(await page.locator('#edit-note-title').inputValue(),'브라우저 메모');pass('Edit loads the current row through GET by ID');
 await page.fill('#edit-note-title','취소할 변경');await page.click('#cancel-edit');
 assert.equal((await(await page.request.get(base+'/api/notes/'+id)).json()).data.title,'브라우저 메모');pass('Cancel edit leaves stored data intact');
 await row.getByRole('button',{name:'수정',exact:true}).click();await page.fill('#edit-note-title','수정 완료');await page.fill('#edit-note-body','');
 await page.selectOption('#language','en');assert.equal(await page.locator('#edit-heading').textContent(),'Edit note');
 await page.screenshot({path:path.join(out,'edit-en.png')});await page.selectOption('#language','ko');
 await page.screenshot({path:path.join(out,'edit-ko.png')});
 const updateResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/notes/'+id&&r.request().method()==='PUT');
 await page.click('#edit-note-form button[type=submit]');const updated=await updateResponse;assert.equal(updated.status(),200);assert.deepEqual((await updated.json()).data,{rowsAffected:1});
 await page.getByRole('heading',{name:'수정 완료',exact:true}).waitFor();
 let saved=(await(await page.request.get(base+'/api/notes/'+id)).json()).data;assert.equal(saved.title,'수정 완료');assert.equal(saved.body,null);pass('Console PUT persists the edited title and clears body to NULL');
 await page.reload();await page.waitForSelector('#workspace:not([hidden])');await page.click('[data-tab="notes"]');await page.getByRole('heading',{name:'수정 완료',exact:true}).waitFor();pass('Page reload preserves the saved Note and remembered login');
 for(const lang of ['ko','en']){await page.selectOption('#language',lang);await page.screenshot({path:path.join(out,'notes-'+lang+'.png')});}
 await page.selectOption('#language','ko');await page.setViewportSize({width:390,height:844});
 row=page.locator('article.note').filter({has:page.getByRole('heading',{name:'수정 완료',exact:true})});await row.getByRole('button',{name:'수정',exact:true}).click();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.querySelector('#edit-dialog').getBoundingClientRect().right<=innerWidth));
 await page.screenshot({path:path.join(out,'mobile-edit.png'),fullPage:true});await page.click('#cancel-edit');pass('Mobile 390px edit dialog fits the screen');
 await row.getByRole('button',{name:'삭제',exact:true}).click();await page.click('#cancel-delete');assert.equal((await page.request.get(base+'/api/notes/'+id)).status(),200);pass('Delete cancellation preserves the Note');
 await row.getByRole('button',{name:'삭제',exact:true}).click();await page.click('#confirm-delete');await page.getByRole('heading',{name:'수정 완료',exact:true}).waitFor({state:'detached'});
 assert.equal((await page.request.get(base+'/api/notes/'+id)).status(),404);pass('Confirmed console deletion removes the database row');
 await page.setViewportSize({width:1280,height:900});await page.click('[data-tab="settings"]');await page.waitForFunction(()=>!document.querySelector('#settings-form').hasAttribute('aria-busy'));
 await page.fill('#app-workspace',workspace);await page.click('#settings-form button[type=submit]');await page.waitForSelector('#restart:not([hidden])');
 await stop();await start();await page.goto(base);await page.waitForSelector('#workspace:not([hidden])');await page.selectOption('#language','ko');
 assert.equal((await(await page.request.get(base+'/admin/settings')).json()).data.effective.workspace,workspace);pass('Console saves an external Unicode workspace and autoloads it after restart');
 await page.click('[data-tab="notes"]');await page.fill('#note-title','Auth CRUD');await page.fill('#note-body','authenticated');await page.click('#note-form button[type=submit]');await page.getByRole('heading',{name:'Auth CRUD',exact:true}).waitFor();
 row=page.locator('article.note').filter({has:page.getByRole('heading',{name:'Auth CRUD',exact:true})});await row.getByRole('button',{name:'수정',exact:true}).click();await page.fill('#edit-note-title','Auth updated');await page.click('#edit-note-form button[type=submit]');await page.getByRole('heading',{name:'Auth updated',exact:true}).waitFor();
 row=page.locator('article.note').filter({has:page.getByRole('heading',{name:'Auth updated',exact:true})});await row.getByRole('button',{name:'삭제',exact:true}).click();await page.click('#confirm-delete');await page.getByRole('heading',{name:'Auth updated',exact:true}).waitFor({state:'detached'});pass('ID/password session completes @Auth Note CRUD');
 const anonymous=await browser.newContext();for(const method of ['GET','POST','PUT','DELETE']){const url=base+'/api/notes'+(['PUT','DELETE'].includes(method)?'/1':'');const r=await anonymous.request.fetch(url,{method,...(['POST','PUT'].includes(method)?{data:{title:'denied'}}:{})});assert.equal(r.status(),401);}await anonymous.close();pass('@Auth denies anonymous requests for every CRUD verb');
 for(const p of files)assert.equal(hash(path.join(workspace,p)),hashes[p]);pass('Controller, service, SQL and both meta files remain unchanged');
 await page.click('#logout');await page.waitForSelector('#login:not([hidden])');await page.fill('#username','note-admin');await page.fill('#password','Note-Browser-2026!');await page.click('#login-submit');await page.waitForSelector('#workspace:not([hidden])');pass('ID/password logout and sign-in');
 assert.deepEqual(errors,[]);pass('No browser JavaScript exceptions');
}catch(e){failure=e;console.error(e.stack);}
finally{
 const version=browser?.version();if(browser)await browser.close();await stop();
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({createdAt:new Date().toISOString(),browser:version,node:process.version,passed:checks.length,failed:failure?1:0,error:failure?.message,checks,pageErrors:errors,requests},null,2)+'\n');
 fs.rmSync(tmp,{recursive:true,force:true});process.exitCode=failure?1:0;
}
