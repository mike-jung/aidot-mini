import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {isIP} from 'node:net';
import {domainToASCII} from 'node:url';
import {parseArgs,parseEnv} from 'node:util';
import {execFileSync} from 'node:child_process';
import {X509Certificate,createPrivateKey,randomBytes} from 'node:crypto';
import {atomicWrite} from '../src/core/atomicFile.js';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const help=`Usage: npm run https:cert -- --hosts localhost,127.0.0.1,::1 --apply

  --hosts <names>  Comma-separated DNS names or IP addresses (default: localhost,127.0.0.1,::1)
  --apply          Enable HTTPS and save certificate paths to .env (or ENV_FILE)
  --dir <path>     Certificate directory, relative to the project (default: certs)
  --days <number>  Validity of a new certificate, 1-365 days (default: 30)
  --force          Replace an existing pair after backing it up
  --help           Show this help

Requires OpenSSL 1.1.1+ to create a certificate. OPENSSL_BIN selects its executable.
Windows also checks common Git for Windows and OpenSSL installation paths.
Existing valid certificates are reused. Restart the server after --apply.
Self-signed certificates require explicit trust on each client; OS trust is not modified.
The cert:dev command remains an alias.`;

function hosts(value){
  const result=value.split(',').map(item=>{
    const host=item.trim().replace(/^\[([^\]]+)\]$/,'$1');
    if(isIP(host))return host;
    const dns=domainToASCII(host).toLowerCase().replace(/\.$/,'');
    if(!dns||dns.length>253||!dns.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))||/[/:@?#\\\s]/.test(host))throw new Error('Invalid --hosts entry; use DNS names or bare IP addresses, without a URL or port');
    return dns;
  });
  if(result.length>64)throw new Error('--hosts supports at most 64 entries');
  return [...new Set(result)];
}
function regular(file){
  if(fs.existsSync(file)&&!fs.lstatSync(file).isFile())throw new Error('Expected a regular file: '+file);
}
function openssl(){
  const choices=process.env.OPENSSL_BIN?[process.env.OPENSSL_BIN]:['openssl'];
  if(!process.env.OPENSSL_BIN&&process.platform==='win32'){
    for(const base of [process.env.ProgramW6432,process.env.ProgramFiles,process.env['ProgramFiles(x86)']])if(base){
      for(const suffix of ['Git/usr/bin/openssl.exe','Git/mingw64/bin/openssl.exe','OpenSSL-Win64/bin/openssl.exe'])choices.push(path.join(base,suffix));
    }
    if(process.env.LOCALAPPDATA)choices.push(path.join(process.env.LOCALAPPDATA,'Programs/Git/usr/bin/openssl.exe'));
  }
  for(const candidate of choices)try{execFileSync(candidate,['version'],{stdio:'pipe',timeout:10000});return candidate;}catch{}
  throw new Error('OpenSSL was not found. Install OpenSSL or Git for Windows, or set OPENSSL_BIN to the openssl executable path.');
}
function inspect(key,cert,names){
  const x=new X509Certificate(fs.readFileSync(cert));
  if(Date.parse(x.validFrom)>Date.now()||Date.parse(x.validTo)<=Date.now())throw new Error('Certificate is expired or not yet valid');
  if(!x.checkPrivateKey(createPrivateKey(fs.readFileSync(key))))throw new Error('Certificate and private key do not match');
  for(const host of names)if(!(isIP(host)?x.checkIP(host):x.checkHost(host,{subject:'never'})))throw new Error('Certificate does not cover '+host);
  return x;
}
function envValue(value){
  if(/[\0\r\n]/.test(value))throw new Error('Certificate paths cannot contain line breaks');
  if(!value.includes('"'))return '"'+value+'"';
  if(!value.includes("'"))return "'"+value+"'";
  throw new Error('Use a certificate directory without both single and double quotes');
}
function applyText(original,settings){
  const eol=original.includes('\r\n')?'\r\n':'\n',bom=original.startsWith('\ufeff')?'\ufeff':'';
  const seen=new Set(),out=[];let quote=null,skip=false;
  for(const line of original.slice(bom.length).split(/\r?\n/)){
    if(quote){if(!skip)out.push(line);if(line.includes(quote)){quote=null;skip=false;}continue;}
    const match=line.match(/^[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*=[ \t]*(.*)$/);
    const value=match?.[2]||'';
    if(['"',"'",'`'].includes(value[0])&&value.indexOf(value[0],1)<0)quote=value[0];
    if(match&&Object.hasOwn(settings,match[1])){
      if(!seen.has(match[1]))out.push(match[1]+'='+settings[match[1]]);
      seen.add(match[1]);skip=Boolean(quote);
    }else out.push(line);
  }
  if(quote)throw new Error('Cannot apply HTTPS to an unterminated quoted .env value');
  while(out.at(-1)==='')out.pop();
  for(const [key,value] of Object.entries(settings))if(!seen.has(key))out.push(key+'='+value);
  const result=bom+out.join(eol)+eol,before=parseEnv(original),after=parseEnv(result);
  for(const [key,value] of Object.entries(before))if(!Object.hasOwn(settings,key)&&after[key]!==value)throw new Error('Cannot safely preserve .env values; edit the HTTPS settings manually');
  for(const [key,value] of Object.entries(settings))if(after[key]!==parseEnv(key+'='+value)[key])throw new Error('Could not apply '+key);
  return result;
}
function configuredPath(file){
  const relative=path.relative(ROOT,file);
  return (!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative)?'./'+relative:file).replaceAll('\\','/');
}
function main(){
  const {values}=parseArgs({options:{hosts:{type:'string',default:'localhost,127.0.0.1,::1'},apply:{type:'boolean'},dir:{type:'string',default:'certs'},days:{type:'string',default:'30'},force:{type:'boolean'},help:{type:'boolean'}}});
  if(values.help){console.log(help);return;}
  const names=hosts(values.hosts),days=Number(values.days);
  if(!Number.isInteger(days)||days<1||days>365)throw new Error('--days must be an integer from 1 to 365');
  const dir=path.resolve(ROOT,values.dir),key=path.join(dir,'server.key'),cert=path.join(dir,'server.crt');
  const envFile=process.env.ENV_FILE?path.resolve(process.env.ENV_FILE):path.join(ROOT,'.env');
  regular(key);regular(cert);if(values.apply)regular(envFile);
  const original=values.apply&&fs.existsSync(envFile)?fs.readFileSync(envFile,'utf8'):'';
  const settings={HTTPS_ENABLED:'true',TLS_CERT_FILE:envValue(configuredPath(cert)),TLS_KEY_FILE:envValue(configuredPath(key))};
  const updated=values.apply?applyText(original,settings):null;
  const hadKey=fs.existsSync(key),hadCert=fs.existsSync(cert),stamp=new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomBytes(3).toString('hex');
  let reused=false,certificate;
  if((hadKey||hadCert)&&!values.force){
    try{if(!hadKey||!hadCert)throw new Error('Incomplete certificate pair');certificate=inspect(key,cert,names);reused=true;}
    catch(error){throw new Error(error.message+'. Use --force to back up and renew, or --dir to choose a new directory.');}
  }
  if(!reused){
    const binary=openssl();fs.mkdirSync(dir,{recursive:true,mode:0o700});
    const temporary=fs.mkdtempSync(path.join(dir,'.https-'));
    const nextKey=path.join(temporary,'server.key'),nextCert=path.join(temporary,'server.crt');
    try{
      execFileSync(binary,['req','-x509','-newkey','rsa:2048','-sha256','-nodes','-keyout',nextKey,'-out',nextCert,'-days',String(days),'-subj','/CN=aidot-mini local HTTPS',
        '-addext','subjectAltName='+names.map(host=>(isIP(host)?'IP:':'DNS:')+host).join(','),'-addext','basicConstraints=critical,CA:FALSE','-addext','keyUsage=critical,digitalSignature,keyEncipherment','-addext','extendedKeyUsage=serverAuth'],{stdio:'pipe',timeout:60000});
      certificate=inspect(nextKey,nextCert,names);
      const previousKey=hadKey?fs.readFileSync(key):null,previousCert=hadCert?fs.readFileSync(cert):null;
      if(hadKey||hadCert){
        const backup=path.join(dir,'backup-'+stamp);fs.mkdirSync(backup,{mode:0o700});
        if(previousKey)atomicWrite(path.join(backup,'server.key'),previousKey);
        if(previousCert)atomicWrite(path.join(backup,'server.crt'),previousCert);
        console.log('Previous certificate pair backed up: '+backup);
      }
      try{atomicWrite(key,fs.readFileSync(nextKey));atomicWrite(cert,fs.readFileSync(nextCert));}
      catch(error){
        if(previousKey)atomicWrite(key,previousKey);else fs.rmSync(key,{force:true});
        if(previousCert)atomicWrite(cert,previousCert);else fs.rmSync(cert,{force:true});
        throw error;
      }
      console.log('OpenSSL: '+binary);
    }finally{fs.rmSync(temporary,{recursive:true,force:true});}
  }
  console.log((reused?'Reused':'Created')+' certificate: '+configuredPath(cert));
  console.log('Hosts: '+names.join(', '));console.log('Expires: '+certificate.validTo);
  if(values.apply){
    if(updated!==original){
      if(fs.existsSync(envFile)){
        const backup=envFile+'.bak-'+stamp;fs.copyFileSync(envFile,backup,fs.constants.COPYFILE_EXCL);fs.chmodSync(backup,0o600);console.log('Environment backup: '+backup);
      }
      atomicWrite(envFile,updated);
    }
    console.log('HTTPS settings applied: '+envFile);
    const displayHost=names.includes('localhost')?'localhost':names[0],urlHost=isIP(displayHost)===6?'['+displayHost+']':displayHost;
    console.log('Restart the server with npm start. Open https://'+urlHost+':8901 (use your configured port if different).');
    const effective=parseEnv(updated);
    for(const name of Object.keys(settings))if(process.env[name]!==undefined&&process.env[name]!==effective[name])console.warn('The process environment overrides '+name+'; update it before restarting.');
  }else console.log('Use --apply to save HTTPS_ENABLED=true, TLS_CERT_FILE and TLS_KEY_FILE to .env.');
  if(certificate.subject===certificate.issuer&&certificate.verify(certificate.publicKey))console.log('This is a self-signed local certificate. Trust server.crt on each test client; use a trusted CA certificate for production.');
}
try{main();}catch(error){console.error('HTTPS certificate setup failed: '+error.message);process.exitCode=1;}
