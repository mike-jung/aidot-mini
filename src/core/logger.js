import fs from 'node:fs';
import path from 'node:path';
import util from 'node:util';
import {currentRequestId} from './requestContext.js';
import config from '../config.js';
const LEVELS={error:0,warn:1,info:2,debug:3};
let level=LEVELS[config.log.level],dir=null,bytes=0,file=null,fileFailed=false;
export function initFileLog(directory){
  try{dir=directory;fs.mkdirSync(dir,{recursive:true,mode:0o700});file=path.join(dir,'server.log');bytes=fs.existsSync(file)?fs.statSync(file).size:0;fileFailed=false;}
  catch{file=null;process.stderr.write('File logging unavailable\n');}
}
function emit(lv,args){
  if(LEVELS[lv]>level)return;
  const id=currentRequestId();
  // Request URLs and secrets are not logged. Bound every entry and its disk retention.
  const line=`${new Date().toISOString()} [${lv.toUpperCase()}]${id?` [${id}]`:''} ${util.format(...args).replace(/[\r\n]/g,' ').slice(0,8192)}\n`;
  (lv==='error'?process.stderr:process.stdout).write(line);
  if(!file||fileFailed)return;
  try{
    if(bytes+Buffer.byteLength(line)>config.log.maxBytes){
      fs.rmSync(`${file}.${config.log.keepFiles-1}`,{force:true});
      for(let i=config.log.keepFiles-2;i>=1;i--)if(fs.existsSync(`${file}.${i}`))fs.renameSync(`${file}.${i}`,`${file}.${i+1}`);
      if(fs.existsSync(file)){if(config.log.keepFiles>1)fs.renameSync(file,`${file}.1`);else fs.rmSync(file);}
      bytes=0;
    }
    fs.appendFileSync(file,line,{mode:0o600});bytes+=Buffer.byteLength(line);
  }catch{fileFailed=true;process.stderr.write('File logging disabled after a write failure\n');}
}
export const logger={error:(...a)=>emit('error',a),warn:(...a)=>emit('warn',a),info:(...a)=>emit('info',a),debug:(...a)=>emit('debug',a),setLevel(l){level=LEVELS[l]??level;},close(){file=null;}};
export default logger;
