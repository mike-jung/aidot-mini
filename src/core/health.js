import db from '../database/db.js';
import {state} from '../state.js';
export function registerHealth(router){
  router.add('GET','/health',(req,res)=>res.json({ok:true,name:'aidot-mini',version:state.version,node:process.version,ts:Date.now()}),{auth:false});
  router.add('GET','/health/live',(req,res)=>res.json({ok:true,status:'alive'}),{auth:false});
  router.add('GET','/health/ready',(req,res)=>{
    const checks={accepting:!state.draining,db:db.isOpen(),migration:state.migrationOk},ok=Object.values(checks).every(Boolean);
    res.status(ok?200:503).json({ok,status:state.draining?'draining':ok?'ready':'not-ready',checks});
  },{auth:false});
}
