"use client";
import StorePagination from "@/components/StorePagination";
import { FormEvent, useEffect, useRef, useState } from "react";
import { useStore } from "@/components/Store";
export default function Inbox() {
  const s = useStore();
  const [active, setActive] = useState<string>(s.conversations[0]?.id || "");
  const [show, setShow] = useState(false);
  const [f, setF] = useState({ name: "", phone: "", product: "" });
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const requestRef = useRef<{ key: string; id: string } | null>(null);
  const initialChatApplied = useRef(false);
  const [linkedConversation,setLinkedConversation]=useState<any>(null);
  const c = s.conversations.find((x) => x.id === active)|| (linkedConversation?.id===active?linkedConversation:undefined);
  const [msgs,setMsgs]=useState<any[]>([]),[historyError,setHistoryError]=useState(''),[older,setOlder]=useState(false),[historyBusy,setHistoryBusy]=useState(false);
  const chatGeneration=useRef(0);const initialHistory=useRef(true);
  async function loadMessages(append=false){if(!active)return;const version=chatGeneration.current;setHistoryBusy(true);try{
    const first=append?msgs[0]:null;
    const url='/api/control/inbox?chat='+encodeURIComponent(active)+(first?'&before='+encodeURIComponent(first.createdAt)+'&beforeId='+encodeURIComponent(first.id):'');
    const r=await fetch(url,{cache:'no-store'}),d=await r.json();if(!r.ok)throw new Error(d.error);if(version!==chatGeneration.current)return;
    setMsgs(previous=>{const combined=append?[...d.messages,...previous]:[...previous,...d.messages];return Array.from(new Map(combined.map(m=>[m.id,m])).values()).sort((a:any,b:any)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id))});
    if(append||initialHistory.current){setOlder(d.hasMore);initialHistory.current=false;}setHistoryError('');
  }catch(e){if(version===chatGeneration.current)setHistoryError((e as Error).message)}finally{if(version===chatGeneration.current)setHistoryBusy(false)}}
  useEffect(()=>{chatGeneration.current++;initialHistory.current=true;setMsgs([]);setOlder(false);void loadMessages();const id=setInterval(()=>{if(!document.hidden)void loadMessages()},15000);return()=>{chatGeneration.current++;clearInterval(id)}},[active]);
  useEffect(()=>{
    const selected=new URLSearchParams(window.location.search).get('chat');
    if(selected&&!initialChatApplied.current){
      initialChatApplied.current=true;setActive(selected);
      void fetch('/api/control/inbox?meta=1&chat='+encodeURIComponent(selected)).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error);setLinkedConversation(d.conversation)}).catch(e=>setHistoryError(e.message));
    }else if(!selected&&(!active||!s.conversations.some(x=>x.id===active))&&s.conversations[0])setActive(s.conversations[0].id);
  },[s.conversations,active]);
  function add(e: FormEvent) {
    e.preventDefault();
    if (!f.name || !f.phone) return;
    s.addConversation(f.name, f.phone, f.product || "-");
    setF({ name: "", phone: "", product: "" });
    setShow(false);
  }
  async function send(e: FormEvent) {
    e.preventDefault();
    if (!c || !text.trim() || sending) return;
    const key = c.id + ":" + text.trim();
    if (requestRef.current?.key !== key)
      requestRef.current = { key, id: crypto.randomUUID() };
    setSending(true);
    try {
      await s.sendMessage(c.id, text.trim(), "OWNER", requestRef.current.id);
      setText("");
      await loadMessages();
      requestRef.current = null;
    } catch {
    } finally {
      setSending(false);
    }
  }
  return (
    <>
      <div className="pageHead">
        <div>
          <h1>Inbox</h1>
          <p>Kontrol percakapan, AI, dan human takeover dari satu layar.</p>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => setShow(!show)}>
            + Kontak WhatsApp
          </button>
          {c && (
            <button
              className="btn primary"
              onClick={() =>
                s.updateConversation(c.id, {
                  humanTakeover: !c.humanTakeover,
                  aiEnabled: c.humanTakeover,
                })
              }
            >
              {c.humanTakeover ? "Kembalikan ke AI" : "Human takeover"}
            </button>
          )}
        </div>
      </div>
      <div className="notice">
        Balasan manual masuk antrean pengiriman. Status SENT berarti gateway
        menerima pesan; penerimaan pelanggan memerlukan bukti delivery.
      </div>
      {show && (
        <form className="card formGrid section" onSubmit={add}>
          <input
            className="input"
            placeholder="Nama customer"
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
          />
          <input
            className="input"
            placeholder="Nomor WhatsApp"
            value={f.phone}
            onChange={(e) => setF({ ...f, phone: e.target.value })}
          />
          <select
            className="input"
            value={f.product}
            onChange={(e) => setF({ ...f, product: e.target.value })}
          >
            <option value="">Pilih produk</option>
            {s.products.map((p) => (
              <option key={p.id}>{p.name}</option>
            ))}
          </select>
          <div className="actions">
            <button className="btn primary">Tambah</button>
            <button
              type="button"
              className="btn"
              onClick={() => setShow(false)}
            >
              Batal
            </button>
          </div>
        </form>
      )}
      <div className="inbox section">
        <div className="card conversationList">
          <input
            className="search"
            placeholder="Cari customer atau nomor..."
            disabled
          />
          <div className="conversationItems">
            {s.conversations.map((x) => (
              <button
                key={x.id}
                className={
                  "conversationItem " + (active === x.id ? "active" : "")
                }
                onClick={() => setActive(x.id)}
              >
                <b>{x.name}</b>
                <span>{x.product}</span>
                <small>{x.phone}</small>
              </button>
            ))}
            {!s.conversations.length && (
              <div className="empty">
                <strong>Belum ada percakapan</strong>Tambahkan kontak WhatsApp
                atau tunggu pesan masuk.
              </div>
            )}
          </div>
        </div>
        <div className="card chatPanel">
          {c ? (
            <>
              <div className="chatHeader">
                <div>
                  <b>{c.name}</b>
                  <div className="tiny muted">
                    {c.phone} · {c.product}
                  </div>
                </div>
                <div className="actions">
                  <button
                    className={"badge " + (c.aiEnabled ? "ok" : "warn")}
                    onClick={() =>
                      s.updateConversation(c.id, { aiEnabled: !c.aiEnabled })
                    }
                  >
                    AI {c.aiEnabled ? "ON" : "OFF"}
                  </button>
                  {c.humanTakeover && (
                    <span className="badge warn">OWNER MODE</span>
                  )}
                </div>
              </div>
              <div className="messageList">
                {historyError&&<div className="notice errorNotice">{historyError}</div>}
                {older&&<button className="btn" disabled={historyBusy} onClick={()=>void loadMessages(true)}>Muat pesan sebelumnya</button>}
                {msgs.map((m) => (
                  <div
                    className={
                      "messageBubble " + (m.direction === "OUT" ? "out" : "")
                    }
                    key={m.id}
                  >
                    <small>
                      {m.sender}
                      {m.status ? " · " + m.status : ""}
                    </small>
                    <div>{m.text}</div>
                  </div>
                ))}
                {!msgs.length && (
                  <div className="empty">
                    <strong>{historyBusy?"Memuat pesan…":"Belum ada pesan"}</strong>Balasan manual dapat diuji
                    di bawah.
                  </div>
                )}
              </div>
              <form className="composer" onSubmit={send}>
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Tulis balasan..."
                  disabled={sending}
                />
                <button
                  className="btn primary"
                  disabled={sending || !text.trim()}
                >
                  {sending ? "Mengantrekan..." : "Kirim"}
                </button>
              </form>
            </>
          ) : (
            <div className="chatBody">Pilih atau tambah percakapan.</div>
          )}
        </div>
      </div>
      <StorePagination/>
    </>
  );
}
