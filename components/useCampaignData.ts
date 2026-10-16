"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { campaignRequest } from "@/lib/campaigns";
const pending=new Map<string,Promise<any>>();
const cache=new Map<string,{data:any,time:number}>();
function request(query:string){
  let p=pending.get(query);
  if(!p){p=campaignRequest(undefined,query).then(data=>{if(cache.size>=20)cache.delete(cache.keys().next().value!);cache.set(query,{data,time:Date.now()});return data}).finally(()=>pending.delete(query));pending.set(query,p)}
  return p;
}
export function useCampaignData(query = "") {
  const generation=useRef(0);
  const [data,setData]=useState<any>(null),[error,setError]=useState(""),[loading,setLoading]=useState(true);
  const refresh=useCallback(async()=>{const version=++generation.current;try{const result=await request(query);if(version===generation.current){setData(result);setError("")}}catch(e){if(version===generation.current)setError(e instanceof Error?e.message:"Gagal memuat")}finally{if(version===generation.current)setLoading(false)}},[query]);
  useEffect(()=>{
    const cached=cache.get(query);setData(cached?.data||null);setLoading(!cached);setError("");
    const timer=setTimeout(()=>{if(!cached||Date.now()-cached.time>20000)void refresh()},250);
    const run=()=>{if(document.visibilityState==='visible')void refresh()};
    const id=setInterval(run,query.includes('view=detail')?15000:60000);
    window.addEventListener('focus',run);
    return()=>{generation.current++;clearTimeout(timer);clearInterval(id);window.removeEventListener('focus',run)};
  },[query,refresh]);
  return {data,error,loading,refresh};
}
