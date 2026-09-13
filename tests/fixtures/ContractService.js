import {Service,Sql} from '../core/decorators.js';
import db from '../database/db.js';
@Service('ContractService')
export default class ContractService {
  @Sql('contract') sql;
  async reset(){
    await db.transaction(async tx=>{
      for(const name of ['clearNotes','clearBooks','clearStudents','clearSequence'])await tx.execute(this.sql.get(name));
    });
    return {ok:true};
  }
  async transaction(){
    const before=(await db.execute(this.sql.get('count'))).rows[0].total;
    await db.transaction(async tx=>{
      await tx.execute(this.sql.get('insert'),{title:'tx-1'});
      await Promise.resolve();
      await tx.execute(this.sql.get('insert'),{title:'tx-2'});
    });
    try{await db.transaction(async tx=>{await tx.execute(this.sql.get('insert'),{title:'rollback'});throw new Error('rollback-fixture');});}
    catch(error){if(error.message!=='rollback-fixture')throw error;}
    return {added:(await db.execute(this.sql.get('count'))).rows[0].total-before};
  }
}
