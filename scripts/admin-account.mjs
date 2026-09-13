import fs from 'node:fs';
import readline from 'node:readline/promises';
import {Writable} from 'node:stream';
import {AdminAccount,validateCredentials} from '../src/core/adminAccount.js';
import config from '../src/config.js';

const args=new Set(process.argv.slice(2));
if(args.has('--help')){
  console.log('Usage: npm run admin:account [-- --reset]');
  console.log('Stop this server first. Enter an ID and password when prompted (password input is hidden).');
  console.log('Use the same DATA_DIR / ENV_FILE and OS user as the server. --reset replaces the account and revokes remembered sessions.');
  console.log('Automation: --stdin reads {"username":"...","password":"..."} from private standard input; never put passwords in command arguments.');
  process.exit(0);
}
for(const arg of args)if(!['--reset','--stdin'].includes(arg))throw new Error('Unknown option: '+arg);
let backup;
try{
  let store;
  try{store=new AdminAccount();}catch(error){
    if(!args.has('--reset'))throw error;
    backup=config.admin.accountFile+'.recovery-'+Date.now();fs.renameSync(config.admin.accountFile,backup);
    store=new AdminAccount();
  }
  if(store.configured&&!args.has('--reset'))throw new Error('Account already exists. Use console Settings or stop the server and run with --reset.');
  let value;
  if(args.has('--stdin')){
    let input='';for await(const chunk of process.stdin){input+=chunk;if(Buffer.byteLength(input)>4096)throw new Error('Credential input is too large');}
    try { value=JSON.parse(input); } catch { throw new Error('Credential input must be valid JSON'); }
  }else{
    if(!process.stdin.isTTY)throw new Error('Interactive terminal required; use --stdin for private piped input');
    let muted=false;
    const output=new Writable({write(chunk,encoding,done){if(!muted)process.stdout.write(chunk,encoding);done();}});
    const rl=readline.createInterface({input:process.stdin,output,terminal:true});
    try{
      console.log('Stop the server before changing its account. Password input is hidden.');
      const username=(await rl.question('Administrator ID [admin]: ')).trim()||'admin';
      process.stdout.write('Password (12-128 characters): ');muted=true;const password=await rl.question('');muted=false;process.stdout.write('\n');
      process.stdout.write('Confirm password: ');muted=true;const confirm=await rl.question('');muted=false;process.stdout.write('\n');
      if(password!==confirm)throw new Error('Passwords do not match');value={username,password};
    }finally{muted=false;rl.close();}
  }
  validateCredentials(value?.username,value?.password);
  await store.exclusive(()=>store.set(value.username,value.password));
  console.log('Administrator account saved. Start the server and sign in with your ID/password.');
  if(backup)console.log('The unreadable previous account file was preserved in a private recovery backup.');
}catch(error){
  if(backup){fs.rmSync(config.admin.accountFile,{force:true});fs.renameSync(backup,config.admin.accountFile);}
  console.error('Account setup failed: '+error.message);process.exitCode=1;
}
