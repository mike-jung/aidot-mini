import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { createContext, runWith } from './requestContext.js';
import logger from './logger.js';
import config from '../config.js';

const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon','.woff2':'font/woff2'};
const error=(status,message)=>Object.assign(new Error(message),{status});
const normalized=p=>p.replace(/\/+$/,'')||'/';
function compile(pattern) {
  if(typeof pattern!=='string'||!pattern.startsWith('/')||/[?#\\\s]/.test(pattern))throw new Error(`Invalid route pattern: ${pattern}`);
  const names=[];
  const segments=normalized(pattern).split('/');
  const rx=segments.map((s,i)=>{
    if(s.startsWith(':')) {
      const n=s.slice(1); if(!/^[A-Za-z_]\w*$/.test(n)||names.includes(n)||['__proto__','constructor','prototype'].includes(n))throw new Error(`Invalid route parameter: ${n}`);
      names.push(n);return '([^/]+)';
    }
    if(s==='*'){if(i!==segments.length-1)throw new Error('Wildcard must be the last segment');names.push('wildcard');return '(.*)';}
    return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  }).join('/');
  return {rx:new RegExp(`^${rx}/?$`),names,rank:segments.map(s=>s==='*'?0:s.startsWith(':')?1:2)};
}
function compare(a,b) {
  for(let i=0;i<Math.max(a.rank.length,b.rank.length);i++) { const n=(b.rank[i]??-1)-(a.rank[i]??-1); if(n)return n; }
  return a.method==='ALL'?1:b.method==='ALL'?-1:0;
}
export class Router {
  constructor(options={}){this.options={bodyLimit:262144,requestTimeout:15000,...options};this.routes=[];this.middlewares=[];this.statics=[];this.notFound=null;}
  use(fn){this.middlewares.push(fn);return this;}
  static_(prefix,dir,{spa=false,setHeaders}={}){this.statics.push({prefix:prefix.replace(/\/+$/,''),dir:path.resolve(dir),spa,setHeaders});return this;}
  add(method,pattern,handler,meta={}) {
    method=method.toUpperCase();
    if(!['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS','ALL'].includes(method)||typeof handler!=='function')throw new Error('Invalid route declaration');
    pattern=normalized(pattern);const shape=p=>p.replace(/:[^/]+/g,':param');
    if(this.routes.some(r=>shape(r.pattern)===shape(pattern)&&(r.method===method||r.method==='ALL'||method==='ALL')))throw new Error(`Duplicate route: ${method} ${pattern}`);
    this.routes.push({method,pattern,...compile(pattern),handler,meta});this.routes.sort(compare);return this;
  }
  match(method,pathname){
    const methods=method==='HEAD'?['HEAD','GET']: [method];
    for(const mth of methods)for(const r of this.routes){
      if(r.method!==mth&&r.method!=='ALL')continue;
      const m=r.rx.exec(pathname);if(!m)continue;
      const params=Object.create(null);
      try {r.names.forEach((n,i)=>{params[n]=decodeURIComponent(m[i+1]);});}catch{throw error(400,'Invalid URL encoding');}
      return {route:r,params};
    }
    return null;
  }
  handler(){
    return (req,res)=>{
      const ctx=createContext(req);
      return runWith(ctx,async()=>{
        decorate(req,res);req.requestId=ctx.requestId;req.log=logger;
        res.setHeader('X-Request-Id',ctx.requestId);res.setHeader('traceparent',`00-${ctx.traceId}-${ctx.spanId}-01`);
        res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');
        res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
        res.setHeader('Cache-Control','no-store');
        const t=Date.now();
        res.once('finish',()=>runWith(ctx,()=>logger[res.statusCode>=500?'error':res.statusCode>=400||Date.now()-t>=config.trace.slowMs?'warn':'debug'](`${req.method} ${req.path||'/'} ${res.statusCode} ${Date.now()-t}ms`)));
        try {
          if(!req.url?.startsWith('/')||req.url.startsWith('//')||req.url.includes('\\'))throw error(400,'Invalid request target');
          const url=new URL(req.url,'http://localhost');
          try{decodeURIComponent(url.pathname);}catch{throw error(400,'Invalid URL encoding');}
          req.path=url.pathname;req.query=Object.fromEntries(url.searchParams);
          const hit=this.match(req.method,req.path);
          req.params=hit?.params||{};req.route=hit?.route.pattern;req.routeMeta=hit?.route.meta||{};
          for(const mw of this.middlewares)if(await mw(req,res)===false||res.writableEnded)return;
          if(hit){
            if((hit.route.meta.auth||hit.route.meta.roles?.length)&&!req.user)throw error(401,'Authentication required');
            if(hit.route.meta.roles?.length&&!hit.route.meta.roles.some(role=>req.user?.roles?.includes(role)))throw error(403,'Insufficient role');
            if(['POST','PUT','PATCH','DELETE'].includes(req.method))await readBody(req,this.options);
            await hit.route.handler(req,res);if(!res.writableEnded&&!hit.route.meta.stream)res.end();return;
          }
          if(await this.serveStatic(req,res,req.path))return;
          const methods=this.routes.filter(r=>r.rx.test(req.path)).map(r=>r.method);
          if(methods.length){res.setHeader('Allow',[...new Set(methods.flatMap(m=>m==='GET'?['GET','HEAD']: [m]))].join(', '));throw error(405,'Method not allowed');}
          if(this.notFound){await this.notFound(req,res);return;}
          throw error(404,`Route not found: ${req.method} ${req.path}`);
        } catch(e) {
          if(res.writableEnded||res.destroyed)return;
          if(res.headersSent){res.destroy();return;}
          const n=Number(e.status||e.statusCode);const status=Number.isInteger(n)&&n>=400&&n<=599?n:500;
          const body={code:status,message:status>=500?'Internal server error':e.message,requestId:req.requestId};
          if(req.routeMeta?.workspace){
            delete body.requestId; // The trace ID remains in the HTTP response header.
            body.message=status>=500?'Internal Server Error':e.message;
            body.header={requestCode:req.body?.requestCode||req.query?.requestCode||null,
              timestamp:new Date().toLocaleString('sv-SE',{timeZone:'Asia/Seoul',hour12:false}).replace('T',' ')};
          }
          res.json(status,body);
          if(status>=500)logger.error(`${req.method} ${req.path||'/'}: ${e.stack||e.message}`);
        }
      });
    };
  }
  async serveStatic(req,res,pathname){
    if(!['GET','HEAD'].includes(req.method))return false;
    const decoded=decodeURIComponent(pathname);
    if(decoded.includes('\0')||decoded.includes('\\')||decoded.split('/').some(x=>x.startsWith('.')))return false;
    for(const s of this.statics){
      if(s.prefix&&decoded!==s.prefix&&!decoded.startsWith(s.prefix+'/'))continue;
      let file=path.resolve(s.dir,'.'+(decoded.slice(s.prefix.length)||'/'));
      if(file===s.dir)file=path.join(file,'index.html');
      try {
        const root=await fs.promises.realpath(s.dir);
        if(s.spa&&!fs.existsSync(file))file=path.join(root,'index.html');
        file=await fs.promises.realpath(file);
        if(!file.startsWith(root+path.sep))continue;
        const stat=await fs.promises.stat(file);if(!stat.isFile())continue;
        res.setHeader('Content-Type',MIME[path.extname(file)]||'application/octet-stream');res.setHeader('Content-Length',stat.size);
        s.setHeaders?.(res,file);
        if(req.method==='HEAD'){res.end();return true;}
        const stream=fs.createReadStream(file);
        stream.once('error',()=>{if(!res.headersSent)res.json(500,{code:500,message:'File unavailable'});else res.destroy();});
        res.once('close',()=>stream.destroy());stream.pipe(res);return true;
      }catch(e){if(!['ENOENT','ENOTDIR','EACCES','ELOOP'].includes(e.code))throw e;}
    }
    return false;
  }
  listen(port,host,cb){
    const options={maxHeaderSize:16384,requestTimeout:this.options.requestTimeout,headersTimeout:this.options.requestTimeout,keepAliveTimeout:5000};
    const server=this.options.tls?https.createServer({...options,...this.options.tls},this.handler()):http.createServer(options,this.handler());
    server.maxRequestsPerSocket=1000;
    server.setTimeout(this.options.requestTimeout+5000,socket=>socket.destroy());
    server.listen(port,host,cb);return server;
  }
}
function decorate(req,res){
  res.status=code=>{res.statusCode=code;return res;};
  res.json=(...args)=>{
    const [status,body]=args.length===2?args:[res.statusCode||200,args[0]];
    const text=JSON.stringify(body??null,(_,v)=>typeof v==='bigint'?v.toString():v);
    res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(text)});
    res.end(req.method==='HEAD'?undefined:text);return res;
  };
  res.text=(...args)=>{const [status,body]=args.length===2?args:[res.statusCode||200,args[0]];res.writeHead(status,{'Content-Type':'text/plain; charset=utf-8'});res.end(req.method==='HEAD'?undefined:String(body));return res;};
  res.set=(k,v)=>{if(k&&typeof k==='object'){for(const [name,value]of Object.entries(k))res.setHeader(name,value);}else res.setHeader(k,v);return res;};
  res.type=value=>{res.setHeader('Content-Type',MIME[value.startsWith('.')?value:'.'+value]||value);return res;};
  res.send=body=>{if(body!==null&&typeof body==='object'&&!Buffer.isBuffer(body))return res.json(body);if(!res.hasHeader('Content-Type'))res.setHeader('Content-Type',typeof body==='string'?'text/html; charset=utf-8':'application/octet-stream');res.end(req.method==='HEAD'?undefined:body??'');return res;};
  req.get=name=>req.headers[String(name).toLowerCase()];req.header=req.get;
}
function readBody(req,{bodyLimit,multipartBodyLimit=6291456,requestTimeout}){
  const ct=String(req.headers['content-type']||'').split(';')[0].trim().toLowerCase();
  const multipart=ct==='multipart/form-data';
  const limit=multipart?multipartBodyLimit:bodyLimit;
  if(req.headers['content-encoding']&&req.headers['content-encoding']!=='identity')throw error(415,'Content encoding is not supported');
  return new Promise((resolve,reject)=>{
    let size=0,done=false;const chunks=[];
    const finish=e=>{
      if(done)return;done=true;clearTimeout(timer);
      req.removeListener('data',data);req.removeListener('end',end);req.removeListener('aborted',aborted);req.removeListener('error',finish);
      if(e){req.resume();reject(e);}else resolve();
    };
    const timer=setTimeout(()=>finish(error(408,'Request body timed out')),requestTimeout);timer.unref();
    const data=c=>{size+=c.length;if(size>limit)return finish(error(413,`Body exceeds ${limit} bytes`));chunks.push(c);};
    const end=()=>{
      try {
        const buffer=Buffer.concat(chunks);
        // Keep binary bytes intact. A workspace upload Service parses FormData.
        if(multipart){req.body=buffer;finish();return;}
        const raw=buffer.toString('utf8');
        if(!raw)req.body={};
        else if(ct==='application/json'||/^application\/[\w.+-]+\+json$/.test(ct))req.body=JSON.parse(raw);
        else if(ct==='application/x-www-form-urlencoded')req.body=Object.fromEntries(new URLSearchParams(raw));
        else throw error(415,'Use application/json or application/x-www-form-urlencoded');
        finish();
      }catch(e){finish(e.status?e:error(400,'Invalid JSON body'));}
    };
    const aborted=()=>finish(error(400,'Request aborted'));
    req.on('data',data);req.once('end',end);req.once('error',finish);req.once('aborted',aborted);
    if(Number(req.headers['content-length'])>limit)finish(error(413,`Body exceeds ${limit} bytes`));
  });
}
export default Router;
