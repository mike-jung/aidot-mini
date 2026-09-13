import {ensureAdminToken} from '../src/core/security.js';
process.stdout.write(ensureAdminToken()+'\n');
