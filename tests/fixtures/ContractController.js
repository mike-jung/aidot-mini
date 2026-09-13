import {Controller,Autowired,GetMapping,PostMapping,Auth,Roles,Validate} from '../core/decorators.js';
@Controller('/compat')
export default class ContractController {
  @Autowired('ContractService') service;
  @PostMapping('/reset') @Auth() @Roles('admin')
  reset(){return this.service.reset();}
  @PostMapping('/merge/:id') @Auth()
  merge(params){return params;}
  @GetMapping('/shape/:kind')
  shape(params){
    if(params.kind==='null')return null;
    if(params.kind==='false')return false;
    if(params.kind==='array')return [1,2,3];
    if(params.kind==='zero')return {data:0};
    return {data:{value:3},meta:{source:'fixture'}};
  }
  @PostMapping('/validated')
  @Validate({safeParse(p){return typeof p.n==='number'?{success:true,data:{n:p.n}}:{success:false,error:{issues:[{path:['n'],code:'invalid',message:'number required'}]}};}})
  validated(params){return params;}
  @PostMapping('/transaction') @Auth()
  transaction(){return this.service.transaction();}
  @GetMapping('/explicit')
  explicit(params,req,res){return res.status(202).json({direct:true});}
}
