import {authorize,apiError} from '@/lib/server/session';
import {db} from '@/lib/server/database';
export async function GET(req:Request){try{
 authorize(req);const encoder=new TextEncoder();let offset=0,tableIndex=0;
 const backup=new URL(req.url).searchParams.has('backup');
 const tables=['customers','payment_evidence','products','leads','orders','payment_verifications','conversations','messages','bot_settings'];
 const escaped=(v:unknown)=>{let text=String(v??'');if(/^[=+@\-]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"'};
 let first=true;
 const stream=new ReadableStream({start(c){c.enqueue(encoder.encode(backup?'{"'+tables[0]+'":[':'\uFEFFOrder,Customer,Produk,Total,HPP,Status\r\n'))},async pull(c){try{
  const rows=await db(backup?tables[tableIndex]+'?select=*&order='+(tables[tableIndex]==='bot_settings'?'key':'id')+'&limit=250&offset='+offset:'orders?select=order_code,product_name,total,cost_hpp,status,customer:customers(name)&status=in.(PAID,FULFILLED)&order=created_at.desc,id&limit=250&offset='+offset);
  if(rows.length){c.enqueue(encoder.encode(backup?(first?'':',')+rows.map((r:any)=>JSON.stringify(r)).join(','):rows.map((r:any)=>[r.order_code,(Array.isArray(r.customer)?r.customer[0]:r.customer)?.name,r.product_name,r.total,r.cost_hpp,r.status].map(escaped).join(',')).join('\r\n')+'\r\n'));first=false}
  offset+=rows.length;
  if(rows.length<250){if(backup&&++tableIndex<tables.length){offset=0;first=true;c.enqueue(encoder.encode('],"'+tables[tableIndex]+'":['))}else{if(backup)c.enqueue(encoder.encode(']}'));c.close()}}
 }catch(e){c.error(e)}}});
 return new Response(stream,{headers:{'content-type':backup?'application/json':'text/csv;charset=utf-8','content-disposition':'attachment; filename="'+(backup?'my-control-backup.json':'my-control-report.csv')+'"','cache-control':'no-store'}})
}catch(e){return apiError(e)}}
