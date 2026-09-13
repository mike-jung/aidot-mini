import fs from 'node:fs';

export class RobotError extends Error {
  constructor(code,status=503){super(code);this.code=code;this.status=status;}
}
const local=host=>['127.0.0.1','localhost','[::1]'].includes(host);
export function endpoint(value,{localOnly=false}={}){
  let url;try{url=new URL(value);}catch{throw new RobotError('INVALID_URL',400);}
  if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||!['http:','https:'].includes(url.protocol))throw new RobotError('INVALID_URL',400);
  if(url.protocol==='http:'&&!local(url.hostname))throw new RobotError('HTTPS_REQUIRED',400);
  if(localOnly&&!local(url.hostname))throw new RobotError('LOCAL_BRIDGE_REQUIRED',400);
  return url.origin;
}
export async function requestJson(url,{body,token,limit=65536,timeout=1500,kind='BRIDGE'}={}){
  let response;
  try{
    response=await fetch(url,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(timeout),redirect:'error'});
    if(!response.ok){await response.body?.cancel();throw new RobotError(response.status===401||response.status===403?`${kind}_AUTH_FAILED`:`${kind}_HTTP_ERROR`);}
    if(!response.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw new RobotError(`${kind}_INVALID_RESPONSE`);
    if(Number(response.headers.get('content-length'))>limit)throw new RobotError(`${kind}_RESPONSE_TOO_LARGE`);
    let size=0;const chunks=[];
    for await(const chunk of response.body){size+=chunk.length;if(size>limit)throw new RobotError(`${kind}_RESPONSE_TOO_LARGE`);chunks.push(chunk);}
    try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new RobotError(`${kind}_INVALID_RESPONSE`);}
  }catch(error){
    if(response?.body&&!response.body.locked)try{await response.body.cancel();}catch{}
    if(error instanceof RobotError)throw error;
    throw new RobotError(`${kind}_UNREACHABLE`);
  }
}
export function privateToken(file){
  try{
    const stat=fs.lstatSync(file);
    if(!stat.isFile()||stat.size>512||(process.platform!=='win32'&&(stat.mode&0o077)))throw new Error();
    const token=fs.readFileSync(file,'utf8').trim();
    if(!/^[\x21-\x7e]{32,256}$/.test(token))throw new Error();
    return token;
  }catch{throw new RobotError('BRIDGE_TOKEN_UNAVAILABLE');}
}
