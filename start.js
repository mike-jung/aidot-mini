import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import config from './src/config.js';
import logger,{initFileLog} from './src/core/logger.js';
import {Router} from './src/core/router.js';
import {tlsOptions} from './src/core/transport.js';
import {createSecurity,ensureAdminToken,isLoopback} from './src/core/security.js';
import {AdminAccount} from './src/core/adminAccount.js';
import {registerSettings} from './src/core/settings.js';
import sqlRegistry from './src/core/sqlLoader.js';
import {resetRegistry,loadServices,loadControllers,listControllers,listServices,listMetadata} from './src/core/controllerLoader.js';
import db from './src/database/db.js';
import {runMigrations} from './src/database/migrationRunner.js';
import {state} from './src/state.js';
import {EventStream} from './src/core/events.js';
import {registerHealth} from './src/core/health.js';
import {registerConsoleWorkspace} from './src/core/consoleWorkspace.js';
export async function createServer({configure}={}){
  if(!isLoopback(config.server.host)&&!config.server.https)throw new Error('LAN access requires HTTPS_ENABLED=true and a certificate');
  const tls=tlsOptions(config.server);
  logger.setLevel(config.log.level);if(config.log.toFile)initFileLog(config.log.dir);
  const freshInstallation=!process.env.ADMIN_TOKEN&&!fs.existsSync(config.admin.tokenFile);
  const token=ensureAdminToken();
  const security=createSecurity(token,new AdminAccount({allowLocalSetup:freshInstallation}));
  state.draining=false;state.migrationOk=false;state.startedAt=Date.now();
  try{
    db.open(config.db.file);
    if(!fs.statSync(config.paths.workspace).isDirectory())throw new Error('APP_WORKSPACE must be a directory');
    const migrations=runMigrations(config.paths.migrations);
    if(migrations.failed.length)throw new Error(`Active application migrations failed: ${migrations.failed.map(x=>x.file).join(', ')}`);
    state.migrationOk=true;
    sqlRegistry.loadDir(config.paths.sql);resetRegistry({sql:sqlRegistry,db,log:logger});
    const router=new Router({...config.server,tls});
    router.use((req,res)=>{if(state.draining&&req.path!=='/health/live'){res.json(503,{code:503,message:'Server is stopping'});return false;}return true;});
    router.use(security.middleware);security.register(router);registerSettings(router);registerHealth(router);registerConsoleWorkspace(router);
    await loadServices(config.paths.services);await loadControllers(router,config.paths.controllers);
    router.add('GET', '/admin/features', (req, res) => {
      const routes = listControllers().filter(c => c.basePath === '/api/notes').flatMap(c => c.routes);
      const has = (method, path) => routes.some(r => r.replace(/\/$/, '') === (method.toUpperCase() + ' /api/notes' + (path === '/' ? '' : path)));
      res.json({ code: 200, data: {
        robot: Boolean(router.features?.robot),
        notes: has('get', '/'),
        noteCreate: has('post', '/'),
        noteUpdate: has('put', '/:id'),
        noteDelete: has('delete', '/:id'),
      } });
    }, { auth: true, roles: ['admin'] });
    router.add('GET','/admin/metadata',(req,res)=>res.json({code:200,data:listMetadata()}),{auth:true,roles:['admin']});
    router.add('GET','/admin/status',(req,res)=>res.json({code:200,data:{version:state.version,node:process.version,uptimeSec:Math.round(process.uptime()),rssMB:Math.round(process.memoryUsage().rss/1048576),db:db.isOpen(),migration:state.migrationOk,protocol:config.server.https?'https':'http',controllers:listControllers(),services:listServices(),queries:sqlRegistry.list(),dependencies:1,workspace:config.paths.workspace}}),{auth:true,roles:['admin']});
    const snapshot=()=>({version:state.version,uptimeSec:Math.round(process.uptime()),rssMB:Math.round(process.memoryUsage().rss/1048576),db:db.isOpen(),migration:state.migrationOk,draining:state.draining});
    const events=new EventStream({authorized:req=>security.authorized(req),snapshot});
    router.add('GET','/admin/events',(req,res)=>events.open(req,res),{auth:true,roles:['admin'],stream:true});
    const eventTimer=setInterval(()=>events.publish('status',snapshot()),10000);eventTimer.unref();
    router.closeStreams=()=>{clearInterval(eventTimer);events.close();};
    if(fs.existsSync(config.paths.public))router.static_('',config.paths.public);
    router.cleanup=()=>{router.closeStreams();security.close();db.close();logger.close();};
    try{if(configure)await configure({router,security,db,logger,state,events});}catch(error){router.closeStreams();throw error;}
    return router;
  }catch(e){db.close();security.close();logger.close();throw e;}
}
export async function main({signals=true,configure}={}){
  const router=await createServer({configure});let server;
  try{
    server=await new Promise((resolve,reject)=>{
      const srv=router.listen(config.server.port,config.server.host,()=>{srv.removeListener('error',reject);resolve(srv);});srv.once('error',reject);
    });
  }catch(e){router.cleanup();throw e;}
  config.server.port=server.address().port;
  if(process.send)process.send({type:'ready',port:config.server.port,protocol:config.server.https?'https':'http'});
  logger.info(`aidot-mini v${state.version} listening on ${config.server.https?'https':'http'}://${config.server.host.includes(':')?'['+config.server.host+']':config.server.host}:${config.server.port}`);
  logger.info('Console: sign in with ID/password. Local account setup or recovery: npm run admin:account');
  let closing;
  const stop=()=>{
    if(closing)return closing;
    state.markDraining();
    router.closeStreams();
    closing=(async()=>{
      let hookError;
      try{await router.beforeClose?.();}catch(error){hookError=error;}
      await new Promise((resolve,reject)=>{
      const force=setTimeout(()=>server.closeAllConnections(),8000);force.unref();
      server.close(e=>{clearTimeout(force);if(e)reject(e);else resolve();});server.closeIdleConnections();
      });
      if(hookError)throw hookError;
    })();return closing;
  };
  const signal=()=>{stop().then(()=>{process.exitCode=0;}).catch(e=>{logger.error(e.message);process.exitCode=1;});};
  const message=value=>{if(value?.type==='aidot:shutdown')signal();};
  if(signals){process.on('SIGINT',signal);process.on('SIGTERM',signal);process.on('message',message);}
  server.once('close',()=>{process.removeListener('SIGINT',signal);process.removeListener('SIGTERM',signal);process.removeListener('message',message);router.cleanup();if(signals&&process.connected)process.disconnect();});
  server.stop=stop;return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){main().catch(e=>{logger.error(`Startup failed: ${e.message}`);process.exitCode=1;});}
export default {createServer,main};
