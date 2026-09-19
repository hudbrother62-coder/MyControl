"use client";
import {createContext,useContext,useEffect,useMemo,useState} from "react";
import {supabase} from "@/lib/supabase-browser";

export type LeadStatus="NEW"|"CONTACTED"|"INTERESTED"|"FOLLOW_UP"|"PENDING"|"STALE"|"CHECKOUT"|"AWAITING_PAYMENT"|"PAYMENT_SUBMITTED"|"PAYMENT_MATCHED"|"WAITING_OWNER_APPROVAL"|"VERIFIED"|"CLOSING"|"FULFILLED"|"LOST";
export type Lead={id:string;name:string;phone:string;product:string;status:LeadStatus;value:number;note:string;updatedAt:string};
export type OrderStatus="AWAITING_PAYMENT"|"PAYMENT_SUBMITTED"|"WAITING_OWNER_APPROVAL"|"PAID"|"FULFILLED"|"CANCELLED"|"REFUNDED";
export type Order={id:string;code:string;customer:string;phone:string;product:string;total:number;cost:number;paymentMethod:string;status:OrderStatus;createdAt:string};
export type PaymentStatus="WAITING_OWNER"|"APPROVED"|"REJECTED"|"MANUAL_REVIEW";
export type Payment={id:string;orderId:string;amount:number;sender:string;evidenceName:string;orderMatch:boolean;screenshotMatch:boolean;providerMatch:boolean;status:PaymentStatus;createdAt:string};
export type Product={id:string;name:string;price:number;cost:number;promoPrice:number;status:"ACTIVE"|"INACTIVE"|"DRAFT";description:string};
export type Message={id:string;conversationId:string;direction:"IN"|"OUT";sender:"CUSTOMER"|"AI"|"OWNER"|"SYSTEM";text:string;createdAt:string};
export type Conversation={id:string;name:string;phone:string;product:string;aiEnabled:boolean;humanTakeover:boolean;updatedAt:string};
export type BotSettings={botEnabled:boolean;aiAutoReply:boolean;humanTakeover:boolean;ownerApproval:boolean;delayMin:number;delayMax:number;maxFollowups:number;workingStart:string;workingEnd:string};

type State={leads:Lead[];orders:Order[];payments:Payment[];products:Product[];conversations:Conversation[];messages:Message[];settings:BotSettings;loading:boolean;error:string};
type Ctx=State&{
 refresh:()=>Promise<void>;
 addLead:(v:Omit<Lead,"id"|"updatedAt">)=>void;updateLead:(id:string,p:Partial<Lead>)=>void;deleteLead:(id:string)=>void;
 addOrder:(v:Omit<Order,"id"|"code"|"createdAt"|"status">)=>void;updateOrder:(id:string,p:Partial<Order>)=>void;
 addPayment:(v:{orderId:string;amount:number;sender:string;evidenceName:string})=>void;updatePayment:(id:string,p:Partial<Payment>)=>void;approvePayment:(id:string)=>void;
 addProduct:(v:Omit<Product,"id"> & {id?:string})=>void;updateProduct:(id:string,p:Partial<Product>)=>void;deleteProduct:(id:string)=>void;
 addConversation:(name:string,phone:string,product:string)=>void;sendMessage:(conversationId:string,text:string,sender:"OWNER"|"AI"|"CUSTOMER")=>void;updateConversation:(id:string,p:Partial<Conversation>)=>void;
 setSettings:(p:Partial<BotSettings>)=>void;exportData:()=>string;signOut:()=>Promise<void>;
};

const defaults:State={
 leads:[],orders:[],payments:[],products:[],conversations:[],messages:[],
 settings:{botEnabled:false,aiAutoReply:true,humanTakeover:true,ownerApproval:true,delayMin:3,delayMax:8,maxFollowups:3,workingStart:"08:00",workingEnd:"22:00"},
 loading:true,error:""
};
const Context=createContext<Ctx|null>(null);

function one(v:any){return Array.isArray(v)?v[0]:v}
function jsonNum(v:any,d:number){return typeof v==="number"?v:Number(v??d)||d}
function jsonBool(v:any,d:boolean){return typeof v==="boolean"?v:(v===true||v==="true"?true:v===false||v==="false"?false:d)}
function jsonText(v:any,d:string){return typeof v==="string"?v:d}

export function StoreProvider({children}:{children:React.ReactNode}){
 const [s,setS]=useState<State>(defaults);

 async function refresh(){
  setS(x=>({...x,loading:true,error:""}));
  const [pr,lr,or,pvr,cr,mr,sr]=await Promise.all([
    supabase.from("products").select("id,name,status,base_price,cost_hpp,promo_price,short_description").order("name"),
    supabase.from("leads").select("id,status,estimated_value,notes,updated_at,customer:customers(name,whatsapp_number),product:products(name)").order("updated_at",{ascending:false}),
    supabase.from("orders").select("id,order_code,product_name,total,cost_hpp,payment_method,status,created_at,customer:customers(name,whatsapp_number)").order("created_at",{ascending:false}),
    supabase.from("payment_verifications").select("id,order_id,order_match,screenshot_match,provider_match,status,created_at,evidence:payment_evidence(extracted_amount,extracted_sender,original_filename)").order("created_at",{ascending:false}),
    supabase.from("conversations").select("id,ai_enabled,human_takeover,updated_at,customer:customers(name,whatsapp_number),product:products(name)").order("updated_at",{ascending:false}),
    supabase.from("messages").select("id,conversation_id,direction,sender_type,content,created_at").order("created_at",{ascending:true}),
    supabase.from("bot_settings").select("key,value")
  ]);
  const firstErr=[pr,lr,or,pvr,cr,mr,sr].find(x=>x.error)?.error;
  if(firstErr){setS(x=>({...x,loading:false,error:firstErr.message}));return}

  const settingsMap=Object.fromEntries((sr.data||[]).map((r:any)=>[r.key,r.value]));
  setS({
    products:(pr.data||[]).map((r:any)=>({id:r.id,name:r.name,status:r.status,price:Number(r.base_price||0),cost:Number(r.cost_hpp||0),promoPrice:Number(r.promo_price||0),description:r.short_description||""})),
    leads:(lr.data||[]).map((r:any)=>({id:r.id,name:one(r.customer)?.name||"-",phone:one(r.customer)?.whatsapp_number||"",product:one(r.product)?.name||"-",status:r.status,value:Number(r.estimated_value||0),note:r.notes||"",updatedAt:r.updated_at})),
    orders:(or.data||[]).map((r:any)=>({id:r.id,code:r.order_code,customer:one(r.customer)?.name||"-",phone:one(r.customer)?.whatsapp_number||"",product:r.product_name,total:Number(r.total||0),cost:Number(r.cost_hpp||0),paymentMethod:r.payment_method||"-",status:r.status,createdAt:r.created_at})),
    payments:(pvr.data||[]).map((r:any)=>({id:r.id,orderId:r.order_id,amount:Number(one(r.evidence)?.extracted_amount||0),sender:one(r.evidence)?.extracted_sender||"",evidenceName:one(r.evidence)?.original_filename||"Bukti pembayaran",orderMatch:Boolean(r.order_match),screenshotMatch:Boolean(r.screenshot_match),providerMatch:Boolean(r.provider_match),status:r.status,createdAt:r.created_at})),
    conversations:(cr.data||[]).map((r:any)=>({id:r.id,name:one(r.customer)?.name||"-",phone:one(r.customer)?.whatsapp_number||"",product:one(r.product)?.name||"-",aiEnabled:Boolean(r.ai_enabled),humanTakeover:Boolean(r.human_takeover),updatedAt:r.updated_at})),
    messages:(mr.data||[]).map((r:any)=>({id:r.id,conversationId:r.conversation_id,direction:r.direction,sender:r.sender_type,text:r.content||"",createdAt:r.created_at})),
    settings:{
      botEnabled:jsonBool(settingsMap.bot_enabled,false),
      aiAutoReply:jsonBool(settingsMap.ai_auto_reply,true),
      humanTakeover:jsonBool(settingsMap.human_takeover_enabled,true),
      ownerApproval:jsonBool(settingsMap.owner_approval_required,true),
      delayMin:jsonNum(settingsMap.reply_delay_min_seconds,3),
      delayMax:jsonNum(settingsMap.reply_delay_max_seconds,8),
      maxFollowups:jsonNum(settingsMap.max_followups,3),
      workingStart:jsonText(settingsMap.working_hours_start,"08:00"),
      workingEnd:jsonText(settingsMap.working_hours_end,"22:00")
    },
    loading:false,error:""
  });
 }

 useEffect(()=>{refresh();const id=setInterval(refresh,15000);return()=>clearInterval(id)},[]);

 async function ensureCustomer(name:string,phone:string){
   if(phone){
     const {data}=await supabase.from("customers").select("id,name").eq("whatsapp_number",phone).maybeSingle();
     if(data){if(name&&data.name!==name)await supabase.from("customers").update({name}).eq("id",data.id);return data.id}
   }
   const {data,error}=await supabase.from("customers").insert({name,whatsapp_number:phone||null}).select("id").single();
   if(error)throw error; return data.id;
 }
 function productIdByName(name:string){return s.products.find(p=>p.name===name)?.id||null}

 function run(job:()=>Promise<void>){void job().catch(e=>setS(x=>({...x,error:e?.message||"Terjadi kesalahan"})))}

 const api=useMemo<Ctx>(()=>({
  ...s,refresh,
  addLead:v=>run(async()=>{const customer_id=await ensureCustomer(v.name,v.phone);await supabase.from("leads").insert({customer_id,product_id:productIdByName(v.product),status:v.status,estimated_value:v.value,notes:v.note});await refresh()}),
  updateLead:(id,p)=>run(async()=>{const patch:any={};if(p.status)patch.status=p.status;if(p.value!==undefined)patch.estimated_value=p.value;if(p.note!==undefined)patch.notes=p.note;await supabase.from("leads").update(patch).eq("id",id);await refresh()}),
  deleteLead:id=>run(async()=>{await supabase.from("leads").delete().eq("id",id);await refresh()}),

  addOrder:v=>run(async()=>{const customer_id=await ensureCustomer(v.customer,v.phone);await supabase.from("orders").insert({customer_id,product_id:productIdByName(v.product),product_name:v.product,total:v.total,subtotal:v.total,cost_hpp:v.cost,payment_method:v.paymentMethod});await refresh()}),
  updateOrder:(id,p)=>run(async()=>{const patch:any={};if(p.status)patch.status=p.status;if(p.total!==undefined){patch.total=p.total;patch.subtotal=p.total}if(p.cost!==undefined)patch.cost_hpp=p.cost;if(p.paymentMethod!==undefined)patch.payment_method=p.paymentMethod;await supabase.from("orders").update(patch).eq("id",id);await refresh()}),

  addPayment:v=>run(async()=>{const {data:evidence,error:e1}=await supabase.from("payment_evidence").insert({order_id:v.orderId,extracted_amount:v.amount,extracted_sender:v.sender,original_filename:v.evidenceName}).select("id").single();if(e1)throw e1;const {error:e2}=await supabase.from("payment_verifications").insert({order_id:v.orderId,evidence_id:evidence.id,status:"WAITING_OWNER"});if(e2)throw e2;await supabase.from("orders").update({status:"PAYMENT_SUBMITTED"}).eq("id",v.orderId);await refresh()}),
  updatePayment:(id,p)=>run(async()=>{const patch:any={};if(p.orderMatch!==undefined)patch.order_match=p.orderMatch;if(p.screenshotMatch!==undefined)patch.screenshot_match=p.screenshotMatch;if(p.providerMatch!==undefined)patch.provider_match=p.providerMatch;if(p.status)patch.status=p.status;const {error}=await supabase.from("payment_verifications").update(patch).eq("id",id);if(error)throw error;await refresh()}),
  approvePayment:id=>run(async()=>{const {error}=await supabase.from("payment_verifications").update({status:"APPROVED"}).eq("id",id);if(error)throw error;await refresh()}),

  addProduct:v=>run(async()=>{const id=v.id||("PRD-"+Date.now());const {error}=await supabase.from("products").insert({id,name:v.name,base_price:v.price,cost_hpp:v.cost,promo_price:v.promoPrice,status:v.status,short_description:v.description,source:"WEB"});if(error)throw error;await refresh()}),
  updateProduct:(id,p)=>run(async()=>{const patch:any={};if(p.name!==undefined)patch.name=p.name;if(p.price!==undefined)patch.base_price=p.price;if(p.cost!==undefined)patch.cost_hpp=p.cost;if(p.promoPrice!==undefined)patch.promo_price=p.promoPrice;if(p.status!==undefined)patch.status=p.status;if(p.description!==undefined)patch.short_description=p.description;const {error}=await supabase.from("products").update(patch).eq("id",id);if(error)throw error;await refresh()}),
  deleteProduct:id=>run(async()=>{const {error}=await supabase.from("products").delete().eq("id",id);if(error)throw error;await refresh()}),

  addConversation:(name,phone,product)=>run(async()=>{const customer_id=await ensureCustomer(name,phone);const {error}=await supabase.from("conversations").insert({customer_id,product_id:productIdByName(product),channel:"WEB_TEST",external_chat_id:"TEST-"+Date.now()+"-"+Math.random().toString(36).slice(2),ai_enabled:true,human_takeover:false,last_message_at:new Date().toISOString()});if(error)throw error;await refresh()}),
  sendMessage:(conversationId,text,sender)=>run(async()=>{const {error}=await supabase.from("messages").insert({conversation_id:conversationId,direction:sender==="CUSTOMER"?"IN":"OUT",sender_type:sender,message_type:"TEXT",content:text});if(error)throw error;await supabase.from("conversations").update({last_message_at:new Date().toISOString(),unread_count:0}).eq("id",conversationId);await refresh()}),
  updateConversation:(id,p)=>run(async()=>{const patch:any={};if(p.aiEnabled!==undefined)patch.ai_enabled=p.aiEnabled;if(p.humanTakeover!==undefined)patch.human_takeover=p.humanTakeover;const {error}=await supabase.from("conversations").update(patch).eq("id",id);if(error)throw error;await refresh()}),

  setSettings:p=>{setS(x=>({...x,settings:{...x.settings,...p}}));run(async()=>{const map:Record<string,any>={botEnabled:"bot_enabled",aiAutoReply:"ai_auto_reply",humanTakeover:"human_takeover_enabled",ownerApproval:"owner_approval_required",delayMin:"reply_delay_min_seconds",delayMax:"reply_delay_max_seconds",maxFollowups:"max_followups",workingStart:"working_hours_start",workingEnd:"working_hours_end"};for(const [k,v] of Object.entries(p)){await supabase.from("bot_settings").upsert({key:map[k],value:v},{onConflict:"key"})}await refresh()})},
  exportData:()=>JSON.stringify({...s,loading:undefined,error:undefined},null,2),
  signOut:async()=>{const token=localStorage.getItem("mycontrol_session");if(token){await supabase.rpc("logout_mycontrol",{p_token:token})}localStorage.removeItem("mycontrol_session");location.reload()}
 }),[s]);

 return <Context.Provider value={api}>{children}</Context.Provider>
}
export function useStore(){const v=useContext(Context);if(!v)throw new Error("StoreProvider missing");return v}
export const rupiah=(n:number)=>new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(n||0);
