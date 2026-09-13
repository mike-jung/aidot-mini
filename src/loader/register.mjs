import {register} from 'node:module';
import path from 'node:path';
import {realpathSync} from 'node:fs';
import {ROOT,DATA_DIR} from '../config.js';
const registered=new Set();
export function registerWorkspaceLoader(root){
  root=realpathSync(path.resolve(root));
  if(registered.has(root))return;
  register('./hooks.mjs',import.meta.url,{data:{root,projectRoot:ROOT,cacheDir:path.join(DATA_DIR,'compile-cache')}});
  registered.add(root);
}
