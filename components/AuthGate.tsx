"use client";
import {FormEvent,useEffect,useState} from "react";
import {supabase} from "@/lib/supabase-browser";

export default function AuthGate({children}:{children:React.ReactNode}){
 const [ready,setReady]=useState(false),[allowed,setAllowed]=useState(false);
 const [username,setUsername]=useState(""),[password,setPassword]=useState(""),[msg,setMsg]=useState("");

 async function checkAccess(){
   const token=localStorage.getItem("mycontrol_session");
   if(!token){setAllowed(false);setReady(true);return}
   const {data,error}=await supabase.rpc("mycontrol_session");
   const row=Array.isArray(data)?data[0]:data;
   if(!error&&row?.username){setAllowed(true);setReady(true);return}
   localStorage.removeItem("mycontrol_session");
   setAllowed(false);setReady(true);
 }

 useEffect(()=>{checkAccess()},[]);

 async function submit(e:FormEvent){
   e.preventDefault();setMsg("Memproses...");
   const {data,error}=await supabase.rpc("login_mycontrol",{p_username:username,p_password:password});
   const row=Array.isArray(data)?data[0]:data;
   if(error||!row?.session_token){setMsg("Username atau password salah.");return}
   localStorage.setItem("mycontrol_session",row.session_token);
   setAllowed(true);setMsg("");
 }

 if(!ready)return <div className="authScreen"><div className="authCard"><div className="authLogo">✓</div><h1>My Control</h1><p>Menyiapkan sesi aman...</p></div></div>;
 if(allowed)return <>{children}</>;

 return <div className="authScreen"><form className="authCard" onSubmit={submit}>
   <div className="authLogo">✓</div><h1>My Control</h1><p>Masuk ke pusat kontrol Bantu Beres.</p>
   <input className="input" autoComplete="username" required placeholder="Username" value={username} onChange={e=>setUsername(e.target.value)}/>
   <input className="input" type="password" autoComplete="current-password" minLength={8} required placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)}/>
   <button className="btn primary authBtn">Masuk</button>
   {msg&&<div className="notice">{msg}</div>}
 </form></div>
}
