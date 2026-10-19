"use client";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { PAGE_SIZE, storeLoadPlan } from "@/lib/loading";
import { supabase } from "@/lib/supabase-browser";

export type LeadStatus =
  | "NEW"
  | "CONTACTED"
  | "INTERESTED"
  | "FOLLOW_UP"
  | "PENDING"
  | "STALE"
  | "CHECKOUT"
  | "AWAITING_PAYMENT"
  | "PAYMENT_SUBMITTED"
  | "PAYMENT_MATCHED"
  | "WAITING_OWNER_APPROVAL"
  | "VERIFIED"
  | "CLOSING"
  | "FULFILLED"
  | "LOST";
export type Lead = {
  id: string;
  name: string;
  phone: string;
  product: string;
  status: LeadStatus;
  value: number;
  note: string;
  updatedAt: string;
};
export type OrderStatus =
  | "AWAITING_PAYMENT"
  | "PAYMENT_SUBMITTED"
  | "WAITING_OWNER_APPROVAL"
  | "PAID"
  | "FULFILLED"
  | "CANCELLED"
  | "REFUNDED";
export type Order = {
  id: string;
  code: string;
  customer: string;
  phone: string;
  product: string;
  total: number;
  cost: number;
  paymentMethod: string;
  status: OrderStatus;
  createdAt: string;
};
export type PaymentStatus =
  "WAITING_OWNER" | "APPROVED" | "REJECTED" | "MANUAL_REVIEW";
export type Payment = {
  id: string;
  orderId: string;
  amount: number;
  sender: string;
  evidenceName: string;
  orderMatch: boolean;
  screenshotMatch: boolean;
  providerMatch: boolean;
  status: PaymentStatus;
  createdAt: string;
};
export type Product = {
  id: string;
  name: string;
  price: number;
  cost: number;
  promoPrice: number;
  status: "ACTIVE" | "INACTIVE" | "DRAFT";
  description: string;
  fullDescription?: string;
  benefits?: string;
  demoUrl?: string;
  checkoutUrl?: string;
};
export type Message = {
  id: string;
  conversationId: string;
  direction: "IN" | "OUT";
  sender: "CUSTOMER" | "AI" | "OWNER" | "SYSTEM";
  text: string;
  createdAt: string;
  status?: string;
};
export type Conversation = {
  id: string;
  name: string;
  phone: string;
  product: string;
  aiEnabled: boolean;
  humanTakeover: boolean;
  updatedAt: string;
};
export type BotSettings = {
  botEnabled: boolean;
  aiAutoReply: boolean;
  humanTakeover: boolean;
  ownerApproval: boolean;
  delayMin: number;
  delayMax: number;
  maxFollowups: number;
  workingStart: string;
  workingEnd: string;
};

type State = {
  inboxAccount: string | null;
  leads: Lead[];
  orders: Order[];
  payments: Payment[];
  products: Product[];
  conversations: Conversation[];
  messages: Message[];
  settings: BotSettings;
  loading: boolean;
  error: string;
};
type Ctx = State & {
  page: number; hasMore: boolean; setPage: (page:number)=>void;
  refresh: () => Promise<void>;
  addLead: (v: Omit<Lead, "id" | "updatedAt">) => void;
  updateLead: (id: string, p: Partial<Lead>) => void;
  deleteLead: (id: string) => void;
  addOrder: (v: Omit<Order, "id" | "code" | "createdAt" | "status">) => void;
  updateOrder: (id: string, p: Partial<Order>) => void;
  addPayment: (v: {
    orderId: string;
    amount: number;
    sender: string;
    evidenceName: string;
  }) => void;
  updatePayment: (id: string, p: Partial<Payment>) => void;
  approvePayment: (id: string) => void;
  addProduct: (v: Omit<Product, "id"> & { id?: string }) => void;
  updateProduct: (id: string, p: Partial<Product>) => void;
  deleteProduct: (id: string) => void;
  addConversation: (name: string, phone: string, product: string) => void;
  sendMessage: (
    conversationId: string,
    text: string,
    sender: "OWNER" | "AI" | "CUSTOMER",
    requestId?: string,
  ) => Promise<void>;
  updateConversation: (id: string, p: Partial<Conversation>) => void;
  setSettings: (p: Partial<BotSettings>) => void;
  exportData: () => string;
  signOut: () => Promise<void>;
};

const defaults: State = {
  inboxAccount: null,
  leads: [],
  orders: [],
  payments: [],
  products: [],
  conversations: [],
  messages: [],
  settings: {
    botEnabled: false,
    aiAutoReply: true,
    humanTakeover: true,
    ownerApproval: true,
    delayMin: 3,
    delayMax: 8,
    maxFollowups: 3,
    workingStart: "08:00",
    workingEnd: "22:00",
  },
  loading: true,
  error: "",
};
const Context = createContext<Ctx | null>(null);

async function checked<T extends { error?: any }>(result: PromiseLike<T>) {
  const r = await result;
  if (r.error) throw r.error;
  return r;
}
function one(v: any) {
  return Array.isArray(v) ? v[0] : v;
}
function jsonNum(v: any, d: number) {
  return typeof v === "number" ? v : Number(v ?? d) || d;
}
function jsonBool(v: any, d: boolean) {
  return typeof v === "boolean"
    ? v
    : v === true || v === "true"
      ? true
      : v === false || v === "false"
        ? false
        : d;
}
function jsonText(v: any, d: string) {
  return typeof v === "string" ? v : d;
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [s, setS] = useState<State>(defaults);
  const path=usePathname();
  const [paging,setPaging]=useState({path,page:0});
  const page=paging.path===path?paging.page:0;
  const generation=useRef(0);
  const activePath=useRef('');
  const plan=storeLoadPlan(path);
  const needs=(name:string)=>plan.includes(name);
  const empty={data:[],error:null};


  async function refresh() {
    const request=++generation.current;
    if(!plan.length){setS({...defaults,loading:false});return;}
    try {
      if(activePath.current!==path+':'+page){activePath.current=path+':'+page;setS(x=>({...x,loading:true,error:''}));}

      const [pr, lr, or, pvr, cr, mr, sr] = await Promise.all([
        needs("products") ? supabase
          .from("products")
          .select(
            "id,name,status,base_price,cost_hpp,promo_price,short_description,full_description,benefits,demo_url,checkout_url",
          )
          .order("name").range(path==="/products"?page*PAGE_SIZE:0,path==="/products"?(page+1)*PAGE_SIZE-1:199) : empty,
        needs("leads") ? supabase
          .from("leads")
          .select(
            "id,status,estimated_value,notes,updated_at,customer:customers(name,whatsapp_number),product:products(name)",
          )
          .order("updated_at", { ascending: false }).range(page*PAGE_SIZE,(page+1)*PAGE_SIZE-1) : empty,
        needs("orders") ? supabase
          .from("orders")
          .select(
            "id,order_code,product_name,total,cost_hpp,payment_method,status,created_at,customer:customers(name,whatsapp_number)",
          )
          .order("created_at", { ascending: false }).range(path==="/orders"?page*PAGE_SIZE:0,path==="/orders"?(page+1)*PAGE_SIZE-1:99) : empty,
        needs("payments") ? supabase
          .from("payment_verifications")
          .select(
            "id,order_id,order_match,screenshot_match,provider_match,status,created_at,evidence:payment_evidence(extracted_amount,extracted_sender,original_filename)",
          )
          .order("created_at", { ascending: false }).range(page*PAGE_SIZE,(page+1)*PAGE_SIZE-1) : empty,
        needs("conversations") ? supabase
          .from("conversations")
          .select(
            "id,ai_enabled,human_takeover,updated_at,customer:customers(name,whatsapp_number),product:products(name)",
          )
          .order("updated_at", { ascending: false }).range(page*PAGE_SIZE,(page+1)*PAGE_SIZE-1) : empty,
        empty,
        needs("settings") ? supabase.from("bot_settings").select("key,value").limit(30) : empty,

      ]);
      if(request!==generation.current)return;
      const firstErr = [pr, lr, or, pvr, cr, mr, sr].find(
        (x) => x.error,
      )?.error;
      if (firstErr) {
        setS((x) => ({ ...x, loading: false, error: firstErr.message }));
        return;
      }

      // Fetch only orders referenced by this verification page, including old orders.
      if(needs("payments") && pvr.data?.length){
        const ids=Array.from(new Set(pvr.data.map((p:any)=>p.order_id))).filter(Boolean);
        if(ids.length){const linked=await supabase.from("orders").select("id,order_code,product_name,total,cost_hpp,payment_method,status,created_at,customer:customers(name,whatsapp_number)").in("id",ids).limit(50);
          if(linked.error)throw new Error(linked.error.message);
          or.data=Array.from(new Map([...(or.data||[]),...(linked.data||[])].map((o:any)=>[o.id,o])).values());
        }
      }
      if(request!==generation.current)return;
      const settingsMap = Object.fromEntries(
        (sr.data || []).map((r: any) => [r.key, r.value]),
      );
      const inboxResponse = needs("queue") ? await fetch('/api/control/inbox?offset='+page*PAGE_SIZE,{cache:'no-store'}) : null;
      if(request!==generation.current)return;
      const inboxData=inboxResponse?await inboxResponse.json():null;
      const queueError=inboxResponse&&!inboxResponse.ok?(inboxData?.error||'Antrean WhatsApp gagal dimuat'):'';
      const inbox=inboxResponse?.ok?inboxData:{leads:[],conversations:[],messages:[]};
      setS({
        inboxAccount: inbox.account || null,
        products: (pr.data || []).map((r: any) => ({
          id: r.id,
          name: r.name,
          status: r.status,
          price: Number(r.base_price || 0),
          cost: Number(r.cost_hpp || 0),
          promoPrice: Number(r.promo_price || 0),
          description: r.short_description || "",
          fullDescription:r.full_description||"",benefits:r.benefits||"",demoUrl:r.demo_url||"",checkoutUrl:r.checkout_url||"",
        })),
        leads: [
          ...inbox.leads,
          ...(lr.data || []).map((r: any) => ({
            id: r.id,
            name: one(r.customer)?.name || "-",
            phone: one(r.customer)?.whatsapp_number || "",
            product: one(r.product)?.name || "-",
            status: r.status,
            value: Number(r.estimated_value || 0),
            note: r.notes || "",
            updatedAt: r.updated_at,
          })),
        ],
        orders: (or.data || []).map((r: any) => ({
          id: r.id,
          code: r.order_code,
          customer: one(r.customer)?.name || "-",
          phone: one(r.customer)?.whatsapp_number || "",
          product: r.product_name,
          total: Number(r.total || 0),
          cost: Number(r.cost_hpp || 0),
          paymentMethod: r.payment_method || "-",
          status: r.status,
          createdAt: r.created_at,
        })),
        payments: (pvr.data || []).map((r: any) => ({
          id: r.id,
          orderId: r.order_id,
          amount: Number(one(r.evidence)?.extracted_amount || 0),
          sender: one(r.evidence)?.extracted_sender || "",
          evidenceName:
            one(r.evidence)?.original_filename || "Bukti pembayaran",
          orderMatch: Boolean(r.order_match),
          screenshotMatch: Boolean(r.screenshot_match),
          providerMatch: Boolean(r.provider_match),
          status: r.status,
          createdAt: r.created_at,
        })),
        conversations: [
          ...inbox.conversations,
          ...(cr.data || []).map((r: any) => ({
            id: r.id,
            name: one(r.customer)?.name || "-",
            phone: one(r.customer)?.whatsapp_number || "",
            product: one(r.product)?.name || "-",
            aiEnabled: Boolean(r.ai_enabled),
            humanTakeover: Boolean(r.human_takeover),
            updatedAt: r.updated_at,
          })),
        ],
        messages: [
          ...inbox.messages,
          ...(mr.data || []).map((r: any) => ({
            id: r.id,
            conversationId: r.conversation_id,
            direction: r.direction,
            sender: r.sender_type,
            text: r.content || "",
            createdAt: r.created_at,
          })),
        ],
        settings: {
          botEnabled: jsonBool(settingsMap.bot_enabled, false),
          aiAutoReply: jsonBool(settingsMap.ai_auto_reply, true),
          humanTakeover: jsonBool(settingsMap.human_takeover_enabled, true),
          ownerApproval: jsonBool(settingsMap.owner_approval_required, true),
          delayMin: jsonNum(settingsMap.reply_delay_min_seconds, 3),
          delayMax: jsonNum(settingsMap.reply_delay_max_seconds, 8),
          maxFollowups: jsonNum(settingsMap.max_followups, 3),
          workingStart: jsonText(settingsMap.working_hours_start, "08:00"),
          workingEnd: jsonText(settingsMap.working_hours_end, "22:00"),
        },
        loading: false,
        error: queueError,
      });
    } catch (e) {
      if(request!==generation.current)return;
      setS((x) => ({
        ...x,
        loading: false,
        error: e instanceof Error ? e.message : "Sinkronisasi gagal",
      }));
    }
  }

  useEffect(()=>{
    void refresh();
    const onFocus=()=>{if(!document.hidden)void refresh()};
    const id=plan.length?setInterval(onFocus,path==='/inbox'?10000:60000):null;
    window.addEventListener('focus',onFocus);
    return()=>{generation.current++;if(id)clearInterval(id);window.removeEventListener('focus',onFocus)};
  },[path,page]);


  async function ensureCustomer(name: string, phone: string) {
    if (phone) {
      const { data } = await checked(
        supabase
          .from("customers")
          .select("id,name")
          .eq("whatsapp_number", phone)
          .maybeSingle(),
      );
      if (data) {
        if (name && data.name !== name)
          await checked(
            supabase.from("customers").update({ name }).eq("id", data.id),
          );
        return data.id;
      }
    }
    const { data, error } = await checked(
      supabase
        .from("customers")
        .insert({ name, whatsapp_number: phone || null })
        .select("id")
        .single(),
    );
    if (error) throw error;
    return data.id;
  }
  function productIdByName(name: string) {
    return s.products.find((p) => p.name === name)?.id || null;
  }

  function run(job: () => Promise<void>) {
    void job().catch((e) =>
      setS((x) => ({ ...x, error: e?.message || "Terjadi kesalahan" })),
    );
  }

  const api = useMemo<Ctx>(
    () => ({
      ...s,
      page,
      setPage:(next:number)=>setPaging({path,page:Math.max(0,next)}),
      hasMore:(path==='/orders'?s.orders:path==='/payments'?s.payments:path==='/products'?s.products:path==='/inbox'?s.conversations:s.leads).length>=PAGE_SIZE,
      refresh,
      addLead: (v) =>
        run(async () => {
          const customer_id = await ensureCustomer(v.name, v.phone);
          await checked(
            supabase
              .from("leads")
              .insert({
                customer_id,
                product_id: productIdByName(v.product),
                status: v.status,
                estimated_value: v.value,
                notes: v.note,
              }),
          );
          await refresh();
        }),
      updateLead: (id, p) =>
        run(async () => {
          if (id.includes("@")) {
            const r = await fetch("/api/control/action", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                action: "lead",
                conversationId: id,
                ...p,
              }),
            });
            const d = await r.json();
            if (!r.ok) throw new Error(d.error);
            await refresh();
            return;
          }
          const patch: any = {};
          if (p.status) patch.status = p.status;
          if (p.value !== undefined) patch.estimated_value = p.value;
          if (p.note !== undefined) patch.notes = p.note;
          await checked(supabase.from("leads").update(patch).eq("id", id));
          await refresh();
        }),
      deleteLead: (id) =>
        run(async () => {
          if (id.includes("@")) {
            const r = await fetch("/api/control/action", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                action: "lead",
                conversationId: id,
                status: "LOST",
              }),
            });
            const d = await r.json();
            if (!r.ok) throw new Error(d.error);
            await refresh();
            return;
          }
          await checked(supabase.from("leads").delete().eq("id", id));
          await refresh();
        }),

      addOrder: (v) =>
        run(async () => {
          const customer_id = await ensureCustomer(v.customer, v.phone);
          await checked(
            supabase
              .from("orders")
              .insert({
                customer_id,
                product_id: productIdByName(v.product),
                product_name: v.product,
                total: v.total,
                subtotal: v.total,
                cost_hpp: v.cost,
                payment_method: v.paymentMethod,
              }),
          );
          await refresh();
        }),
      updateOrder: (id, p) =>
        run(async () => {
          const patch: any = {};
          if (p.status) patch.status = p.status;
          if (p.total !== undefined) {
            patch.total = p.total;
            patch.subtotal = p.total;
          }
          if (p.cost !== undefined) patch.cost_hpp = p.cost;
          if (p.paymentMethod !== undefined)
            patch.payment_method = p.paymentMethod;
          await checked(supabase.from("orders").update(patch).eq("id", id));
          await refresh();
        }),

      addPayment: (v) =>
        run(async () => {
          const { data: evidence, error: e1 } = await checked(
            supabase
              .from("payment_evidence")
              .insert({
                order_id: v.orderId,
                extracted_amount: v.amount,
                extracted_sender: v.sender,
                original_filename: v.evidenceName,
              })
              .select("id")
              .single(),
          );
          if (e1) throw e1;
          const { error: e2 } = await checked(
            supabase
              .from("payment_verifications")
              .insert({
                order_id: v.orderId,
                evidence_id: evidence.id,
                status: "WAITING_OWNER",
              }),
          );
          if (e2) throw e2;
          await checked(
            supabase
              .from("orders")
              .update({ status: "PAYMENT_SUBMITTED" })
              .eq("id", v.orderId),
          );
          await refresh();
        }),
      updatePayment: (id, p) =>
        run(async () => {
          const patch: any = {};
          if (p.orderMatch !== undefined) patch.order_match = p.orderMatch;
          if (p.screenshotMatch !== undefined)
            patch.screenshot_match = p.screenshotMatch;
          if (p.providerMatch !== undefined)
            patch.provider_match = p.providerMatch;
          if (p.status) patch.status = p.status;
          const { error } = await checked(
            supabase.from("payment_verifications").update(patch).eq("id", id),
          );
          if (error) throw error;
          await refresh();
        }),
      approvePayment: (id) =>
        run(async () => {
          const { error } = await checked(
            supabase
              .from("payment_verifications")
              .update({ status: "APPROVED" })
              .eq("id", id),
          );
          if (error) throw error;
          await refresh();
        }),

      addProduct: (v) =>
        run(async () => {
          const id = v.id || "PRD-" + Date.now();
          const { error } = await checked(
            supabase
              .from("products")
              .insert({
                id,
                name: v.name,
                base_price: v.price,
                cost_hpp: v.cost,
                promo_price: v.promoPrice,
                status: v.status,
                short_description: v.description,
                full_description:v.fullDescription||"",benefits:v.benefits||"",demo_url:v.demoUrl||"",checkout_url:v.checkoutUrl||"",
                source: "WEB",
              }),
          );
          if (error) throw error;
          await refresh();
        }),
      updateProduct: (id, p) =>
        run(async () => {
          const patch: any = {};
          for(const [key,column] of [["fullDescription","full_description"],["benefits","benefits"],["demoUrl","demo_url"],["checkoutUrl","checkout_url"]] as const)if(p[key]!==undefined)patch[column]=p[key];
          if (p.name !== undefined) patch.name = p.name;
          if (p.price !== undefined) patch.base_price = p.price;
          if (p.cost !== undefined) patch.cost_hpp = p.cost;
          if (p.promoPrice !== undefined) patch.promo_price = p.promoPrice;
          if (p.status !== undefined) patch.status = p.status;
          if (p.description !== undefined)
            patch.short_description = p.description;
          const { error } = await checked(
            supabase.from("products").update(patch).eq("id", id),
          );
          if (error) throw error;
          await refresh();
        }),
      deleteProduct: (id) =>
        run(async () => {
          const { error } = await checked(
            supabase.from("products").delete().eq("id", id),
          );
          if (error) throw error;
          await refresh();
        }),

      addConversation: (name, phone, product) =>
        run(async () => {
          const r = await fetch("/api/control/action", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "contact",
              name,
              phone,
              productId: productIdByName(product),
            }),
          });
          const d = await r.json();
          if (!r.ok) throw new Error(d.error || "Gagal menambahkan kontak");
          await refresh();
        }),
      sendMessage: async (conversationId, text, sender, requestId) => {
        try {
          if (sender !== "OWNER")
            throw new Error("Pesan uji pelanggan tidak dikirim dari dashboard");
          const r = await fetch("/api/control/action", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "send",
              conversationId,
              text,
              requestId: requestId || crypto.randomUUID(),
            }),
          });
          const d = await r.json();
          if (!r.ok) throw new Error(d.error || "Gagal mengantrekan pesan");
          await refresh();
        } catch (e) {
          setS((x) => ({
            ...x,
            error: e instanceof Error ? e.message : "Gagal mengantrekan pesan",
          }));
          throw e;
        }
      },
      updateConversation: (id, p) =>
        run(async () => {
          if (p.humanTakeover !== undefined || p.aiEnabled !== undefined) {
            const enabled = p.humanTakeover ?? !p.aiEnabled;
            const r = await fetch("/api/control/action", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                action: "takeover",
                conversationId: id,
                enabled,
              }),
            });
            const d = await r.json();
            if (!r.ok) throw new Error(d.error || "Gagal mengubah takeover");
          }
          await refresh();
        }),

      setSettings: (p) => {
        setS((x) => ({ ...x, settings: { ...x.settings, ...p } }));
        run(async () => {
          const map: Record<string, any> = {
            botEnabled: "bot_enabled",
            aiAutoReply: "ai_auto_reply",
            humanTakeover: "human_takeover_enabled",
            ownerApproval: "owner_approval_required",
            delayMin: "reply_delay_min_seconds",
            delayMax: "reply_delay_max_seconds",
            maxFollowups: "max_followups",
            workingStart: "working_hours_start",
            workingEnd: "working_hours_end",
          };
          for (const [k, v] of Object.entries(p)) {
            await checked(
              supabase
                .from("bot_settings")
                .upsert({ key: map[k], value: v }, { onConflict: "key" }),
            );
          }
          await refresh();
        });
      },
      exportData: () =>
        JSON.stringify({ ...s, loading: undefined, error: undefined }, null, 2),
      signOut: async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        localStorage.removeItem("mycontrol_session");
        location.reload();
      },
    }),
    [s,path,page],
  );

  return <Context.Provider value={api}>{children}</Context.Provider>;
}
export function useStore() {
  const v = useContext(Context);
  if (!v) throw new Error("StoreProvider missing");
  return v;
}
export const rupiah = (n: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(n || 0);
