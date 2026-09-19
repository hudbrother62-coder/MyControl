import {createClient} from "@supabase/supabase-js";

const fallbackUrl="https://vpneonfehqfsxclqcman.supabase.co";
const fallbackKey="sb_publishable_YkREgaElAb6fR4QnhhMFtA_7IOQldgd";
const envUrl=process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const useEnv=envUrl.includes("vpneonfehqfsxclqcman");
const url=useEnv?envUrl:fallbackUrl;
const key=useEnv?(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || fallbackKey):fallbackKey;

const customFetch: typeof fetch = async (input,init={})=>{
  const headers=new Headers(init.headers||{});
  if(typeof window!=="undefined"){
    const token=localStorage.getItem("mycontrol_session");
    if(token)headers.set("x-client-info","mycontrol:"+token);
  }
  return fetch(input,{...init,headers});
};

export const supabase=createClient(url,key,{
  global:{fetch:customFetch},
  auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}
});
