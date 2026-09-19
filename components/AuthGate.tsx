"use client";
import {FormEvent,useEffect,useState} from "react";
import {supabase} from "@/lib/supabase-browser";

export default function AuthGate({children}:{children:React.ReactNode}){
 const [ready,setReady]=useState(false),[allowed,setAllowed]=useState(false),[hasOwner,setHasOwner]=useState<boolean|null>(null);
 const [mode,setMode]=useState<"login"|"signup">("login");
 const [email,setEmail]=useState(""),[password,setPassword]=useState(""),[msg,setMsg]=useState("");

 async function checkAccess(){
   const {data:{session}}=await supabase.auth.getSession();
   const {data:ownerData}=await supabase.rpc("has_owner");
   const ownerExists=Boolean(ownerData); setHasOwner(ownerExists);
   if(!session){setAllowed(false);setReady(true);return}
   const {data:access}=await supabase.rpc("my_access");
   const row=Array.isArray(access)?access[0]:access;
   if(row?.is_member){setAllowed(true);setReady(true);return}
   if(!ownerExists){
     const {data:claim,error}=await supabase.rpc("claim_first_owner");
     if(!error && (claim==="OWNER_CREATED"||claim==="OWNER_ALREADY_EXISTS")){
       const {data:a2}=await supabase.rpc("my_access"); const r2=Array.isArray(a2)?a2[0]:a2;
       setAllowed(Boolean(r2?.is_member)); setReady(true); return;
     }
   }
   setAllowed(false);setMsg("Akun ini tidak memiliki akses My Control.");setReady(true);
 }

 useEffect(()=>{checkAccess();const {data}=supabase.auth.onAuthStateChange(()=>setTimeout(checkAccess,0));return()=>data.subscription.unsubscribe()},[]);

 async function submit(e:FormEvent){e.preventDefault();setMsg("Memproses...");
   if(mode==="signup"){
     const {data,error}=await supabase.auth.signUp({email,password});
     if(error){setMsg(error.message);return}
     if(!data.session){setMsg("Akun dibuat. Cek email untuk konfirmasi, lalu login.");setMode("login");return}
     setMsg("Akun owner dibuat.");await checkAccess();return;
   }
   const {error}=await supabase.auth.signInWithPassword({email,password});
   if(error){setMsg("Login gagal: "+error.message);return}
   setMsg("");await checkAccess();
 }
 if(!ready)return <div className="authScreen"><div className="authCard"><div className="authLogo">✓</div><h1>My Control</h1><p>Menyiapkan sesi aman...</p></div></div>;
 if(allowed)return <>{children}</>;
 return <div className="authScreen"><form className="authCard" onSubmit={submit}><div className="authLogo">✓</div><h1>My Control</h1><p>{hasOwner?"Masuk ke pusat kontrol Bantu Beres.":"Buat akun owner pertama untuk mengunci sistem."}</p>
   <input className="input" type="email" required placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)}/>
   <input className="input" type="password" minLength={8} required placeholder="Password minimal 8 karakter" value={password} onChange={e=>setPassword(e.target.value)}/>
   <button className="btn primary authBtn">{mode==="login"?"Masuk":"Buat akun owner"}</button>
   {!hasOwner&&<button type="button" className="linkBtn" onClick={()=>{setMode(mode==="login"?"signup":"login");setMsg("")}}>{mode==="login"?"Belum punya akun? Buat owner pertama":"Sudah punya akun? Login"}</button>}
   {msg&&<div className="notice">{msg}</div>}
 </form></div>
}
