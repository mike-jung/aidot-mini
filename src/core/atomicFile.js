import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
export function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive:true, mode:0o700 });
  const tmp = `${file}.${randomBytes(8).toString('hex')}.tmp`;
  let fd;
  try {
    fd = fs.openSync(tmp,'wx',0o600);
    fs.writeFileSync(fd,value); fs.fsyncSync(fd); fs.closeSync(fd); fd=undefined;
    fs.renameSync(tmp,file);
    if (process.platform !== 'win32') {
      const dir=fs.openSync(path.dirname(file),'r');
      try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
    }
  } finally { if(fd!==undefined)fs.closeSync(fd); fs.rmSync(tmp,{force:true}); }
}
