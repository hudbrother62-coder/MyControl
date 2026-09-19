import {createClient} from "@supabase/supabase-js";

const fallbackUrl="https://vpneonfehqfsxclqcman.supabase.co";
const fallbackKey="sb_publishable_YkREgaElAb6fR4QnhhMFtA_7IOQldgd";
const envUrl=process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const useEnv=envUrl.includes("vpneonfehqfsxclqcman");
const url=useEnv?envUrl:fallbackUrl;
const key=useEnv?(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || fallbackKey):fallbackKey;

export const supabase=createClient(url,key,{
  auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}
});
