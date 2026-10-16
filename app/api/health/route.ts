import { db,dbConfig } from '@/lib/server/database';
let cached:{time:number,database:{configured:boolean,connected:boolean}}|undefined;
let pending:Promise<void>|undefined;
export async function GET(){
 if(!cached||Date.now()-cached.time>15000){
  if(!pending)pending=(async()=>{let configured=false,connected=false;try{dbConfig();configured=true;await db('mc_campaign_contacts?select=phone&limit=1');connected=true}catch{}cached={time:Date.now(),database:{configured,connected}}})().finally(()=>{pending=undefined});
  await pending;
 }
 return Response.json({ok:true,service:'mycontrol',database:cached!.database},{headers:{'Cache-Control':'no-store'}});
}
