import {createClient} from "@supabase/supabase-js";

const url=process.env.NEXT_PUBLIC_SUPABASE_URL || "https://vpneonfehqfsxclqcman.supabase.co";
const key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "sb_publishable_YkREgaElAb6fR4QnhhMFtA_7IOQldgd";

export const supabase=createClient(url,key,{
  auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
});
