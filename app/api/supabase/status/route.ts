import {createClient} from "@supabase/supabase-js";
export const dynamic="force-dynamic";
const expectedUrl="https://vpneonfehqfsxclqcman.supabase.co";
const publishable="sb_publishable_YkREgaElAb6fR4QnhhMFtA_7IOQldgd";

export async function GET(){
 const envUrl=process.env.NEXT_PUBLIC_SUPABASE_URL||"";
 const service=process.env.SUPABASE_SERVICE_ROLE_KEY||"";
 const url=envUrl.includes("vpneonfehqfsxclqcman")?envUrl:expectedUrl;
 const pub=createClient(url,publishable);
 const {error:publicError}=await pub.from("products").select("id",{head:true,count:"exact"});
 let serviceConnected=false;
 if(service){
   const admin=createClient(expectedUrl,service,{auth:{persistSession:false}});
   const {error}=await admin.from("customers").select("id",{head:true,count:"exact"});
   serviceConnected=!error;
 }
 return Response.json({
  projectRef:"vpneonfehqfsxclqcman",
  urlMatches:envUrl.includes("vpneonfehqfsxclqcman"),
  publicConnected:!publicError,
  serviceRoleConfigured:Boolean(service),
  serviceConnected
 });
}
