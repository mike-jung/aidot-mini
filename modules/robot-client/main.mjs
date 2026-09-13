import {main} from '../../start.js';
import {DATA_DIR} from '../../src/config.js';
import {RobotManager} from './manager.mjs';
let manager;
await main({configure:({router,logger})=>{manager=new RobotManager({directory:DATA_DIR,logger});manager.register(router);}});
manager.start();
