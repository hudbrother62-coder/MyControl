import { authorize, apiError } from "@/lib/server/session";
import { db } from "@/lib/server/database";

const fields = {
  target_customers: 2500,
  customer_problems: 3500,
  key_benefits: 3500,
  verified_features: 3500,
  differentiators: 2500,
  use_cases: 3500,
  objections: 3500,
  proof_points: 2500,
  limitations: 2500,
  next_step: 1800,
} as const;
const productId = (v: unknown) => {
  if (typeof v !== "string" || !/^[A-Za-z0-9_-]{2,80}$/.test(v)) throw new Error("Produk tidak valid");
  return v;
};
const promoId = (v: unknown) => {
  if (typeof v !== "string" || !/^[a-f0-9-]{36}$/i.test(v)) throw new Error("ID penawaran tidak valid");
  return v;
};
export async function GET(req: Request) {
  try {
    authorize(req);
    const [products, guides, promotions] = await Promise.all([
      db("products?select=id,name,status,base_price,short_description,full_description,benefits&order=name&limit=150"),
      db("mc_product_sales_guides?select=*&order=product_id&limit=150"),
      db("promotions?select=id,product_id,name,discount_type,discount_value,start_at,end_at,notes,active,updated_at&order=updated_at.desc&limit=150"),
    ]);
    return Response.json({ products, guides, promotions }, { headers: { "Cache-Control": "no-store" } });
  } catch(e) { return apiError(e); }
}
export async function POST(req: Request) {
  try {
    authorize(req, true);
    const raw = await req.text();
    if (raw.length > 45000) return Response.json({error:"Data terlalu panjang"},{status:413});
    const body = JSON.parse(raw);
    if (!body || typeof body !== "object") throw new Error("Data tidak valid");
    if (body.action === "save_guide") {
      const id = productId(body.product_id);
      if (!body.guide || typeof body.guide !== "object" || Array.isArray(body.guide)) throw new Error("Materi tidak valid");
      const row: Record<string, unknown> = { product_id:id };
      for (const [field, max] of Object.entries(fields)) {
        const value = body.guide[field];
        if (typeof value !== "string" || value.length > max)
          throw new Error("Isi "+field+" maksimal "+max+" karakter");
        row[field] = value.trim();
      }
      const found = await db("products?select=id&id=eq."+encodeURIComponent(id)+"&limit=1");
      if (!found.length) throw new Error("Produk belum terdaftar");
      const saved = await db("mc_product_sales_guides?on_conflict=product_id", {
        method:"POST",
        headers:{Prefer:"resolution=merge-duplicates,return=representation"},
        body:JSON.stringify(row),
      });
      return Response.json({ok:true,guide:saved[0]});
    }
    if (body.action === "save_offer") {
      const id=productId(body.product_id);
      const name = String(body.name||"").trim();
      if (!name || name.length>120) throw new Error("Nama promosi 1–120 karakter");
      if (!["FIXED","PERCENT"].includes(body.discount_type)) throw new Error("Jenis diskon tidak valid");
      const value=Number(body.discount_value);
      if (!Number.isFinite(value)||value<=0||(body.discount_type==="PERCENT"&&value>100))
        throw new Error("Diskon tidak valid");
      if (typeof body.notes !== "string" || body.notes.length>2000) throw new Error("Keterangan maksimal 2.000 karakter");
      const start=body.start_at ? new Date(body.start_at):null;
      const end=body.end_at ? new Date(body.end_at):null;
      if ((start && !Number.isFinite(start.getTime()))||(end && !Number.isFinite(end.getTime()))||
          (start && end && end<=start)) throw new Error("Tanggal promo tidak valid");
      const found = await db("products?select=id&id=eq."+encodeURIComponent(id)+"&limit=1");
      if (!found.length) throw new Error("Produk tidak ditemukan");
      const row:Record<string,unknown>={
        name,product_id:id,discount_type:body.discount_type,discount_value:value,
        notes:body.notes.trim(),start_at:start?.toISOString()||null,end_at:end?.toISOString()||null,
        active:body.active===true
      };
      if (body.id) row.id=promoId(body.id);
      const saved=await db("promotions"+(body.id?"?on_conflict=id":""),{
        method:"POST",
        headers:{Prefer:"resolution=merge-duplicates,return=representation"},
        body:JSON.stringify(row),
      });
      return Response.json({ok:true,offer:saved[0]});
    }
    if (body.action === "toggle_offer") {
      const id=promoId(body.id);
      if (typeof body.active!=="boolean") throw new Error("Status tidak valid");
      const result=await db("promotions?id=eq."+id,{
        method:"PATCH",headers:{Prefer:"return=representation"},
        body:JSON.stringify({active:body.active})
      });
      if (!result.length) return Response.json({error:"Promosi tidak ditemukan"},{status:404});
      return Response.json({ok:true,offer:result[0]});
    }
    return Response.json({error:"Aksi tidak dikenal"},{status:400});
  } catch(e) { return apiError(e); }
}
