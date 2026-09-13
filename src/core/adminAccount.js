import fs from 'node:fs';
import path from 'node:path';
import {randomBytes, scrypt, timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import config from '../config.js';
import {atomicWrite} from './atomicFile.js';

const derive = promisify(scrypt);
// OWASP's lower-memory scrypt profile: 16 MiB, with a larger CPU work factor.
const parameters = {N:16384, r:8, p:5, maxmem:32 * 1024 * 1024};
const fail = (status, message) => Object.assign(new Error(message), {status});
const usernamePattern = /^[A-Za-z0-9_.@-]{3,64}$/;
const random = () => randomBytes(32).toString('base64url');

export function validateCredentials(username, password) {
  if (typeof username !== 'string' || !usernamePattern.test(username))
    throw fail(400, 'ID must contain 3 to 64 letters, digits, or _.@-');
  if (typeof password !== 'string' || password.length < 12 || password.length > 128 || /[\u0000-\u001f\u007f]/.test(password))
    throw fail(400, 'Password must contain 12 to 128 characters without control characters');
}

/** One local administrator; private file, independent of application SQL schemas. */
export class AdminAccount {
  constructor({allowLocalSetup=false}={}) {
    this.file = config.admin.accountFile;
    fs.mkdirSync(path.dirname(this.file), {recursive:true, mode:0o700});
    const initial = {schema:1, localSetup:allowLocalSetup, account:null, remembered:[]};
    try { fs.writeFileSync(this.file, JSON.stringify(initial)+'\n', {flag:'wx', mode:0o600}); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    if (fs.statSync(this.file).size > 131072) throw new Error('Administrator account file is too large');
    try { this.data = JSON.parse(fs.readFileSync(this.file, 'utf8')); }
    catch { throw new Error('Cannot read administrator account file; restore it or use admin:account --reset'); }
    if (!this.data || typeof this.data !== 'object' || Array.isArray(this.data))
      throw new Error('Invalid administrator account file; restore it or use admin:account --reset');
    const {schema, account, remembered, localSetup} = this.data;
    if (schema !== 1 || typeof localSetup !== 'boolean' || !Array.isArray(remembered) || remembered.length > 64)
      throw new Error('Invalid administrator account file; restore it or use admin:account --reset');
    if (account !== null && (!account || !usernamePattern.test(account.username) ||
      !/^[A-Za-z0-9_-]{43}$/.test(account.revision) || account.password?.algorithm !== 'scrypt' ||
      account.password.N !== parameters.N || account.password.r !== parameters.r || account.password.p !== parameters.p ||
      !/^[a-f0-9]{32}$/.test(account.password.salt) || !/^[a-f0-9]{64}$/.test(account.password.hash)))
      throw new Error('Invalid administrator password record; restore it or use admin:account --reset');
    this.busy = false;
    this.closed = false;
    this.dummy = {salt:randomBytes(16).toString('hex'), hash:randomBytes(32).toString('hex')};
  }
  get configured() { return Boolean(this.data.account); }
  get username() { return this.data.account?.username || ''; }
  get revision() { return this.data.account?.revision || 'unconfigured'; }
  get localSetup() { return !this.configured && this.data.localSetup; }
  save(next) { atomicWrite(this.file, JSON.stringify(next, null, 2)+'\n'); this.data = next; }
  remember(records) { this.save({...this.data, remembered:records}); }
  async exclusive(fn) {
    if (this.closed || this.busy) throw fail(503, 'Authentication is busy; try again shortly');
    this.busy = true;
    try { return await fn(); } finally { this.busy = false; }
  }
  async verify(username, password) {
    const record = this.data.account;
    const hash = record?.password || this.dummy;
    // Unknown IDs take the same expensive path. Bound input before scrypt.
    const candidate = typeof password === 'string' && password.length <= 128 ? password : '';
    const result = await derive(candidate, Buffer.from(hash.salt, 'hex'), 32, parameters);
    return !this.closed && record === this.data.account && Boolean(record) &&
      timingSafeEqual(result, Buffer.from(hash.hash, 'hex')) && username === record.username && candidate === password;
  }
  async set(username, password) {
    validateCredentials(username, password);
    const salt = randomBytes(16).toString('hex');
    const hash = await derive(password, Buffer.from(salt, 'hex'), 32, parameters);
    if (this.closed) throw fail(503, 'Server is stopping');
    const account = {username, revision:random(), password:{algorithm:'scrypt', N:parameters.N, r:parameters.r, p:parameters.p, salt, hash:hash.toString('hex')}};
    this.save({schema:1, localSetup:false, account, remembered:[]});
  }
  close() { this.closed = true; }
}
