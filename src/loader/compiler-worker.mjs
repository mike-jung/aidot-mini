import {parentPort} from 'node:worker_threads';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
// Browser API in an isolated context avoids spawning a second executable on Android.
const sandbox={module:{exports:{}},console,crypto:webcrypto,performance,TextEncoder,TextDecoder,
  setTimeout,clearTimeout,Uint8Array,Uint32Array,Int32Array,ArrayBuffer,DataView,WebAssembly};
sandbox.self=sandbox;
vm.runInNewContext(await fs.readFile(new URL(import.meta.resolve('esbuild-wasm/lib/browser.js')),'utf8'),sandbox,{filename:'esbuild-browser.js'});
const compiler=sandbox.module.exports;
await compiler.initialize({worker:false,wasmModule:await WebAssembly.compile(await fs.readFile(new URL(import.meta.resolve('esbuild-wasm/esbuild.wasm'))))});
parentPort.on('message',async({id,source,filename})=>{
  try{
    const result=await compiler.transform(source,{
      loader:'ts',format:'esm',target:'es2022',sourcefile:filename,sourcemap:'inline',
      tsconfigRaw:{compilerOptions:{target:'ES2022',module:'ESNext',useDefineForClassFields:false,
        experimentalDecorators:true,emitDecoratorMetadata:false}},
    });
    parentPort.postMessage({id,code:result.code});
  }catch(error){parentPort.postMessage({id,error:error.message});}
});
