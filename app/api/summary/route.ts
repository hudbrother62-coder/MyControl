import {authorize,apiError} from '@/lib/server/session';
import {rpc} from '@/lib/server/database';
let cached:{time:number;data:any}|null=null;let pending:Promise<any>|null=null;
export async function GET(req:Request){try{authorize(req);if(!cached||Date.now()-cached.time>15000){pending??=rpc('mc_dashboard_summary').then(data=>{cached={time:Date.now(),data};return data}).finally(()=>{pending=null});await pending;}return Response.json(cached!.data,{headers:{'cache-control':'private, no-store'}})}catch(e){return apiError(e)}}
