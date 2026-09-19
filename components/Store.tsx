"use client";
import {createContext,useContext,useEffect,useMemo,useState} from "react";

export type LeadStatus="NEW"|"FOLLOW_UP"|"PENDING"|"STALE"|"CLOSING"|"LOST";
export type Lead={id:string;name:string;phone:string;product:string;status:LeadStatus;value:number;note:string;updatedAt:string};
export type OrderStatus="AWAITING_PAYMENT"|"PAYMENT_SUBMITTED"|"WAITING_OWNER_APPROVAL"|"PAID"|"FULFILLED"|"CANCELLED";
export type Order={id:string;code:string;customer:string;phone:string;product:string;total:number;cost:number;paymentMethod:string;status:OrderStatus;createdAt:string};
export type PaymentStatus="WAITING_ANALYSIS"|"WAITING_OWNER"|"APPROVED"|"REJECTED"|"MANUAL_REVIEW";
export type Payment={id:string;orderId:string;amount:number;sender:string;evidenceName:string;orderMatch:boolean;screenshotMatch:boolean;providerMatch:boolean;status:PaymentStatus;createdAt:string};
export type Product={id:string;name:string;price:number;cost:number;promoPrice:number;status:"ACTIVE"|"INACTIVE";description:string};
export type Message={id:string;conversationId:string;direction:"IN"|"OUT";sender:"CUSTOMER"|"AI"|"OWNER";text:string;createdAt:string};
export type Conversation={id:string;name:string;phone:string;product:string;aiEnabled:boolean;humanTakeover:boolean;updatedAt:string};
export type BotSettings={botEnabled:boolean;aiAutoReply:boolean;humanTakeover:boolean;ownerApproval:boolean;delayMin:number;delayMax:number;maxFollowups:number;workingStart:string;workingEnd:string};

type State={leads:Lead[];orders:Order[];payments:Payment[];products:Product[];conversations:Conversation[];messages:Message[];settings:BotSettings};
type Ctx=State&{
 addLead:(v:Omit<Lead,"id"|"updatedAt">)=>void;updateLead:(id:string,p:Partial<Lead>)=>void;deleteLead:(id:string)=>void;
 addOrder:(v:Omit<Order,"id"|"code"|"createdAt"|"status">)=>void;updateOrder:(id:string,p:Partial<Order>)=>void;
 addPayment:(v:{orderId:string;amount:number;sender:string;evidenceName:string})=>void;updatePayment:(id:string,p:Partial<Payment>)=>void;approvePayment:(id:string)=>void;
 addProduct:(v:Omit<Product,"id"> & {id?:string})=>void;updateProduct:(id:string,p:Partial<Product>)=>void;deleteProduct:(id:string)=>void;
 addConversation:(name:string,phone:string,product:string)=>void;sendMessage:(conversationId:string,text:string,sender:"OWNER"|"AI"|"CUSTOMER")=>void;updateConversation:(id:string,p:Partial<Conversation>)=>void;
 setSettings:(p:Partial<BotSettings>)=>void;resetAll:()=>void;exportData:()=>string;importData:(raw:string)=>boolean;
};

const defaults:State={
 leads:[],orders:[],payments:[],
 products:[
  {id:"KP001",name:"Bantu Beres — Asisten AI Kepala Sekolah",price:0,cost:0,promoPrice:0,status:"ACTIVE",description:""},
  {id:"BK001",name:"Bantu Beres Buku Kerja Digital",price:0,cost:0,promoPrice:0,status:"ACTIVE",description:""},
  {id:"GP001",name:"Bantu Beres Gajian Pro",price:0,cost:0,promoPrice:0,status:"ACTIVE",description:""}
 ],
 conversations:[],messages:[],
 settings:{botEnabled:false,aiAutoReply:true,humanTakeover:true,ownerApproval:true,delayMin:3,delayMax:8,maxFollowups:3,workingStart:"08:00",workingEnd:"22:00"}
};
const Context=createContext<Ctx|null>(null);
const key="bb-mycontrol-v2";
const uid=()=>crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
const now=()=>new Date().toISOString();

export function StoreProvider({children}:{children:React.ReactNode}){
 const [s,setS]=useState<State>(defaults);
 const [ready,setReady]=useState(false);
 useEffect(()=>{try{const raw=localStorage.getItem(key);if(raw)setS({...defaults,...JSON.parse(raw)});}catch{}setReady(true)},[]);
 useEffect(()=>{if(ready)localStorage.setItem(key,JSON.stringify(s))},[s,ready]);
 const api=useMemo<Ctx>(()=>({
  ...s,
  addLead:v=>setS(x=>({...x,leads:[{...v,id:uid(),updatedAt:now()},...x.leads]})),
  updateLead:(id,p)=>setS(x=>({...x,leads:x.leads.map(i=>i.id===id?{...i,...p,updatedAt:now()}:i)})),
  deleteLead:id=>setS(x=>({...x,leads:x.leads.filter(i=>i.id!==id)})),
  addOrder:v=>setS(x=>{const n=x.orders.length+1;const code="BB-"+new Date().toISOString().slice(0,10).replaceAll("-","")+"-"+String(n).padStart(4,"0");return {...x,orders:[{...v,id:uid(),code,status:"AWAITING_PAYMENT",createdAt:now()},...x.orders]}}),
  updateOrder:(id,p)=>setS(x=>({...x,orders:x.orders.map(i=>i.id===id?{...i,...p}:i)})),
  addPayment:v=>setS(x=>({...x,payments:[{...v,id:uid(),orderMatch:false,screenshotMatch:false,providerMatch:false,status:"WAITING_ANALYSIS",createdAt:now()},...x.payments],orders:x.orders.map(o=>o.id===v.orderId?{...o,status:"PAYMENT_SUBMITTED"}:o)})),
  updatePayment:(id,p)=>setS(x=>({...x,payments:x.payments.map(i=>i.id===id?{...i,...p}:i)})),
  approvePayment:id=>setS(x=>{const p=x.payments.find(i=>i.id===id);if(!p)return x;return {...x,payments:x.payments.map(i=>i.id===id?{...i,status:"APPROVED"}:i),orders:x.orders.map(o=>o.id===p.orderId?{...o,status:"PAID"}:o)}}),
  addProduct:v=>setS(x=>({...x,products:[{...v,id:v.id||("PRD-"+String(x.products.length+1).padStart(3,"0"))},...x.products]})),
  updateProduct:(id,p)=>setS(x=>({...x,products:x.products.map(i=>i.id===id?{...i,...p}:i)})),
  deleteProduct:id=>setS(x=>({...x,products:x.products.filter(i=>i.id!==id)})),
  addConversation:(name,phone,product)=>setS(x=>({...x,conversations:[{id:uid(),name,phone,product,aiEnabled:true,humanTakeover:false,updatedAt:now()},...x.conversations]})),
  sendMessage:(conversationId,text,sender)=>setS(x=>({...x,messages:[...x.messages,{id:uid(),conversationId,direction:sender==="CUSTOMER"?"IN":"OUT",sender,text,createdAt:now()}],conversations:x.conversations.map(c=>c.id===conversationId?{...c,updatedAt:now()}:c)})),
  updateConversation:(id,p)=>setS(x=>({...x,conversations:x.conversations.map(c=>c.id===id?{...c,...p,updatedAt:now()}:c)})),
  setSettings:p=>setS(x=>({...x,settings:{...x.settings,...p}})),
  resetAll:()=>setS(defaults),
  exportData:()=>JSON.stringify(s,null,2),
  importData:raw=>{try{const d=JSON.parse(raw);setS({...defaults,...d});return true}catch{return false}}
 }),[s]);
 return <Context.Provider value={api}>{children}</Context.Provider>
}
export function useStore(){const v=useContext(Context);if(!v)throw new Error("StoreProvider missing");return v}
export const rupiah=(n:number)=>new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(n||0);
