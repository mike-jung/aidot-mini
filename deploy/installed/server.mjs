// A child may touch application state only after its supervisor records ownership.
// This launch gate closes the fork/PID-record race during a supervisor crash.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let server;
let closing = false;
let release;
const begin = new Promise(resolve => { release = resolve; });
const close = () => {
  closing = true;
  release(false);
  if (server) server.stop().catch(error => { console.error(error.message); process.exitCode = 1; });
};
process.on('disconnect', close);
const message = value => {
  if (value?.type === 'aidot:begin') release(true);
  if (value?.type === 'aidot:shutdown') close();
};
process.on('message', message);
if (!process.connected) close();
try {
  if (await begin && !closing) {
    if (process.argv.includes('--compile')) {
      process.argv = [process.argv[0], path.join(root, 'scripts/compile-workspace.mjs'), process.env.APP_WORKSPACE];
      await import('../../scripts/compile-workspace.mjs');
      if (process.connected) process.disconnect();
    } else {
      const { main } = await import('../../start.js');
      if (!closing) {
        let manager;
        if (process.argv.includes('--robot')) {
          const { RobotManager } = await import('../../modules/robot-client/manager.mjs');
          const { DATA_DIR } = await import('../../src/config.js');
          server = await main({ configure: ({ router, logger }) => { manager = new RobotManager({ directory: DATA_DIR, logger }); manager.register(router); } });
          manager.start();
        } else server = await main();
        if (closing) await server.stop();
      }
    }
  }
} catch (error) {
  console.error(`Installed runtime failed: ${error.message}`);
  process.exitCode = 1;
  if (process.connected) process.disconnect();
}
// A stopped-before-start child must not keep the supervisor's IPC channel alive.
if (!server) {
  process.off('message', message);
  if (process.connected) process.disconnect();
}
