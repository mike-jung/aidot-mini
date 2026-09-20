import fs from 'node:fs';
import path from 'node:path';
import {randomBytes, createHash, timingSafeEqual} from 'node:crypto';
import config from '../config.js';
import {state} from '../state.js';
import {validateCredentials} from './adminAccount.js';
import apiAuth from './apiAuth.js';

const err=(status,message)=>Object.assign(new Error(message),{status});
const digest=x=>createHash('sha256').update(String(x)).digest();
const fingerprint=x=>digest(x).toString('hex');
const same=(a,b)=>timingSafeEqual(digest(a),digest(b));
const random=()=>randomBytes(32).toString('base64url');
export const isLoopback=host=>['127.0.0.1','::1','localhost'].includes(host);

/**
 * 요청이 이 기기 안에서 온 것인지.
 *
 *  프록시를 거친 요청은 로컬로 보지 않는다. 리버스 프록시 뒤에 두면 모든 요청의
 *  소켓 주소가 127.0.0.1 로 보이기 때문에, 그것만 믿으면 "로컬 전용" 이 사실상
 *  아무도 막지 못하는 설정이 된다. 전달 헤더가 붙어 있으면 바깥에서 온 것으로
 *  간주해 막는 쪽(fail-closed)을 택한다.
 */
export function isLocalRequest(req){
  if(req.headers?.['x-forwarded-for']||req.headers?.['forwarded'])return false;
  const raw=String(req.socket?.remoteAddress||'');
  const address=raw.startsWith('::ffff:')?raw.slice(7):raw;
  // 점 네 자리를 끝까지 맞춘다. '127.0.0.1.evil.com' 같은 문자열이 접두사만으로
  // 통과하지 않게 하려는 것이다.
  return address==='::1'||/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(address);
}

/**
 * 관리 콘솔에 속한 요청인지 — 업무 API 는 제한 대상이 아니다.
 *
 *  콘솔 = /admin/* (콘솔 API) + 매칭되는 라우트가 없는 정적 파일(콘솔 화면).
 *  워크스페이스 라우트, /health, 업로드된 파일은 콘솔이 아니다.
 */
export function isConsoleRequest(req){
  if(req.routeMeta?.workspace)return false;
  const pathname=req.path||'';
  if(pathname==='/health'||pathname.startsWith('/health/'))return false;
  if(pathname.startsWith('/uploads/'))return false;
  if(pathname.startsWith('/admin/'))return true;
  return !req.route;   // 라우트에 없으면 콘솔 화면을 이루는 정적 파일이다
}
export function ensureAdminToken(){
  let token=process.env.ADMIN_TOKEN;
  if(!token){
    fs.mkdirSync(path.dirname(config.admin.tokenFile),{recursive:true,mode:0o700});
    if(!fs.existsSync(config.admin.tokenFile)){
      try{fs.writeFileSync(config.admin.tokenFile,random()+'\n',{flag:'wx',mode:0o600});}
      catch(e){if(e.code!=='EEXIST')throw e;}
    }
    token=fs.readFileSync(config.admin.tokenFile,'utf8').trim();
  }
  if(!/^[\x21-\x7e]{32,256}$/.test(token))throw new Error('Admin token must contain 32 to 256 printable ASCII characters without spaces');
  return token;
}
export function createSecurity(token,account){
  const sessions=new Map(),failures=new Map();
  const keyFingerprint=fingerprint(token);
  const hosts=new Set(['127.0.0.1','localhost','::1',config.server.host.toLowerCase(),...config.server.allowedHosts]);
  for(const row of account.data.remembered){
    if(row&&/^[a-f0-9]{64}$/.test(row.id)&&/^[A-Za-z0-9_-]{43}$/.test(row.csrf)&&row.method==='password'&&row.remember===true&&
      row.revision===account.revision&&row.keyFingerprint===keyFingerprint&&Number.isSafeInteger(row.expires)&&row.expires>Date.now()&&
      row.expires<=Date.now()+config.admin.rememberDays*86400000){const {id,...value}=row;sessions.set(id,value);}
  }
  const persist=()=>account.remember([...sessions].filter(([,s])=>s.remember&&s.expires>Date.now()).map(([id,s])=>({id,...s})));
  if(sessions.size!==account.data.remembered.length)persist();
  const prune=()=>{
    const now=Date.now();for(const[k,v]of sessions)if(v.expires<=now)sessions.delete(k);
    for(const[k,v]of failures)if(v.until<=now)failures.delete(k);
  };
  function origin(req){
    let parsed;
    try{if(!req.headers.host||/[\s/@\\,#]/.test(req.headers.host))throw 0;parsed=new URL(`${req.socket.encrypted?'https':'http'}://${req.headers.host}`);}catch{throw err(400,'Invalid Host header');}
    const host=parsed.hostname.replace(/^\[|\]$/g,'').toLowerCase();
    if(!hosts.has(host)&&host!==req.socket.localAddress?.replace(/^::ffff:/,'').toLowerCase())throw err(403,'Host is not allowed; configure ALLOWED_HOSTS');
    return parsed.origin;
  }
  function session(req){
    const raw=String(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('aidot_session='))?.slice(14);
    if(!raw||!/^[A-Za-z0-9_-]{43}$/.test(raw))return null;
    const id=fingerprint(raw),active=sessions.get(id);
    return active?.expires>Date.now()&&active.revision===account.revision?{id,...active}:null;
  }
  const cookie=(req,value,age)=>`aidot_session=${value}; Path=/; HttpOnly; SameSite=Strict${age===undefined?'':'; Max-Age='+age}${req.socket.encrypted?'; Secure':''}`;
  const localSetup=req=>account.localSetup&&isLoopback(config.server.host)&&
    isLoopback((req.socket.remoteAddress||'').replace(/^::ffff:/,''))&&
    isLoopback(new URL(origin(req)).hostname.replace(/^\[|\]$/g,''));
  const view=req=>({configured:account.configured,username:account.username,loginMethod:session(req)?.method||'key',rememberDays:config.admin.rememberDays,sessionMinutes:config.admin.sessionMinutes});
  function attempt(req,res){
    prune();const ip=req.socket.remoteAddress||'local';const f=failures.get(ip);
    if(f?.count>=8){res.setHeader('Retry-After',Math.max(1,Math.ceil((f.until-Date.now())/1000)));throw err(429,'Too many sign-in attempts; try again later');}
    if(!f&&failures.size>=2048)failures.delete(failures.keys().next().value);
    // Reserve the attempt before asynchronous hashing; concurrent requests cannot skip the limit.
    failures.set(ip,{count:(f?.count||0)+1,until:f?.until||Date.now()+60000});
    return ()=>failures.delete(ip);
  }
  function signIn(req,res,method,remember=false){
    if(account.closed)throw err(503,'Server is stopping');
    const previous=session(req);if(previous)sessions.delete(previous.id);
    prune();if(sessions.size>=64)sessions.delete(sessions.keys().next().value);
    const id=random(),csrf=random();
    const age=remember?config.admin.rememberDays*86400:config.admin.sessionMinutes*60;
    sessions.set(fingerprint(id),{csrf,expires:Date.now()+age*1000,method,remember,revision:account.revision,keyFingerprint});
    try{persist();}catch(e){sessions.delete(fingerprint(id));throw e;}
    res.setHeader('Set-Cookie',cookie(req,id,remember?age:undefined));
    res.json({code:200,data:{csrfToken:csrf,...view(req),username:account.username,loginMethod:method,expiresAt:Date.now()+age*1000}});
  }
  return {
    authorized(req){
      // realm='user' 토큰은 middleware 에서 서명·만료를 이미 확인했다.
      if(req.user?.authType==='token')return req.user.realm==='user';
      if(req.user?.authType==='bearer')return same(/^Bearer (\S+)$/i.exec(String(req.headers.authorization||''))?.[1]||'',token);
      return req.user?.authType==='session'&&Boolean(session(req));
    },
    middleware(req,res){
      // CONSOLE_ACCESS=local 이면 관리 콘솔은 이 기기에서만 열린다.
      // 콘솔이 있다는 사실 자체를 알리지 않도록 403 이 아니라 404 로 답한다.
      if(config.console.access==='local'&&isConsoleRequest(req)&&!isLocalRequest(req))
        throw err(404,`Route not found: ${req.method} ${req.path||'/'}`);
      const expected=origin(req);
      if(req.headers.origin&&req.headers.origin!==expected)throw err(403,'Cross-origin requests are not allowed');
      if(req.headers['sec-fetch-site']==='cross-site')throw err(403,'Cross-site requests are not allowed');
      const bearer=/^Bearer (\S+)$/i.exec(String(req.headers.authorization||''));
      const active=session(req);
      if(bearer&&same(bearer[1],token))req.user={id:account.username||'admin',roles:['admin'],role:'admin',realm:'admin',authType:'bearer'};
      else{
        // 관리자 토큰이 아니면 realm='user' API 토큰인지 본다 (서명·만료 검증).
        const claims=bearer?apiAuth.verifyAccessToken(bearer[1]):null;
        if(claims)req.user={id:claims.sub,sub:claims.sub,username:claims.username,role:claims.role,roles:[claims.role],realm:'user',authType:'token'};
        else if(active)req.user={id:account.username||'admin',roles:['admin'],role:'admin',realm:'admin',authType:'session'};
      }
      const protectedRoute=req.routeMeta.auth===true||req.routeMeta.roles?.length>0;
      // 프레임워크 라우트(/admin/* 등)는 표시가 없으면 관리자 realm 전용으로 본다.
      // 워크스페이스 라우트는 컨트롤러의 @Auth({realm}) 가드가 따로 판정한다.
      const wantRealm=req.routeMeta.realm??(req.routeMeta.workspace?'any':'admin');
      if(protectedRoute&&!req.user){res.setHeader('WWW-Authenticate','Bearer realm="aidot-mini"');throw err(401,wantRealm==='user'?'Authentication required':'Administrator sign-in required');}
      if(protectedRoute&&wantRealm!=='any'&&req.user.realm!==wantRealm)throw err(403,'This credential cannot access this endpoint');
      if(req.routeMeta.roles?.length&&!req.routeMeta.roles.some(role=>req.user?.roles.includes(role)))throw err(403,'Insufficient role');
      if(active&&req.user?.authType==='session'&&!['GET','HEAD','OPTIONS'].includes(req.method)&&!same(req.headers['x-csrf-token']||'',active.csrf))throw err(403,'Invalid CSRF token');
      return true;
    },
    register(router){
      // realm='user' 계정용 /api/auth/login · refresh · logout
      apiAuth.registerApiAuth(router);
      router.add('GET','/admin/preferences',(req,res)=>res.json({code:200,data:{language:config.console.language,version:state.version}}),{auth:false});
      router.add('GET','/admin/auth',(req,res)=>res.json({code:200,data:{configured:account.configured,localSetup:localSetup(req),rememberDays:config.admin.rememberDays,sessionMinutes:config.admin.sessionMinutes}}),{auth:false});
      router.add('POST','/admin/setup',async(req,res)=>{
        if(account.configured)throw err(409,'Administrator account already exists');
        if(!localSetup(req)||req.headers.origin!==origin(req))throw err(403,'Use the local account command or sign in with the existing administrator key');
        const success=attempt(req,res);
        await account.exclusive(async()=>{if(account.configured)throw err(409,'Administrator account already exists');await account.set(req.body?.username,req.body?.password);});
        sessions.clear();success();signIn(req,res,'password',req.body.remember===true);
      },{auth:false});
      router.add('POST','/admin/login',async(req,res)=>{
        const success=attempt(req,res);
        if(typeof req.body?.token==='string'&&!('username' in req.body)&&!('password' in req.body)){
          if(!same(req.body.token,token))throw err(401,'Invalid sign-in credentials');
          success();signIn(req,res,'key');return;
        }
        const valid=await account.exclusive(()=>account.verify(req.body?.username,req.body?.password));
        if(!valid)throw err(401,'Invalid sign-in credentials');
        success();signIn(req,res,'password',req.body.remember===true);
      },{auth:false});
      router.add('GET','/admin/session',(req,res)=>res.json({code:200,data:{csrfToken:session(req)?.csrf||null,language:config.console.language,...view(req)}}),{auth:true});
      router.add('GET','/admin/account',(req,res)=>res.json({code:200,data:view(req)}),{auth:true});
      router.add('PUT','/admin/account',async(req,res)=>{
        const success=attempt(req,res);
        const active=session(req),remember=active?.remember===true;
        // A key-authenticated administrator may recover the password. Password sessions must reauthenticate.
        await account.exclusive(async()=>{
          if(account.configured&&req.user.authType!=='bearer'&&active?.method!=='key'&&
            !await account.verify(account.username,req.body?.currentPassword))throw err(401,'Current password is incorrect');
          if(req.user.authType==='session'&&!session(req))throw err(401,'Administrator sign-in required');
          validateCredentials(req.body?.username,req.body?.password);
          await account.set(req.body.username,req.body.password);
        });
        sessions.clear();success();signIn(req,res,'password',remember);
      },{auth:true,roles:['admin']});
      router.add('POST','/admin/logout',(req,res)=>{
        const active=session(req);if(active)sessions.delete(active.id);
        persist();res.setHeader('Set-Cookie',cookie(req,'',0));res.json({code:200});
      },{auth:true});
    },
    close(){account.close();sessions.clear();failures.clear();},
  };
}
