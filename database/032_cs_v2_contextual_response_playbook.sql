begin;

-- Add a narrow, backward-compatible quality layer to the existing AI context.
-- Older campaign/CRM/memory functions continue to supply the canonical data.
alter function public.mc_get_ai_context(text,integer)
  rename to mc_get_ai_context_before_cs_quality;

create function public.mc_get_ai_context(
  p_chat_id text, p_history_limit integer default 30
) returns jsonb language sql stable security definer set search_path=public as $$
with base as (
 select public.mc_get_ai_context_before_cs_quality(p_chat_id,p_history_limit) as j
), last_customer as (
 select trim(e.message_text) as message_text,e.received_at
 from public.mc_inbound_events e
 where e.chat_id=p_chat_id and not e.from_me and not e.is_group
   and nullif(trim(e.message_text),'') is not null
 order by e.received_at desc limit 1
), explicit_product as (
 select k.source_key,k.payload->>'product_name' as product_name
 from public.mc_runtime_knowledge k cross join last_customer l
 where k.kind='PRODUCT' and k.active=true
   and (
     strpos(lower(l.message_text),lower(k.payload->>'product_name'))>0
     or (
       length(regexp_replace(lower(k.payload->>'product_name'),
               '^bantu beres[[:space:]]*[-—]?[[:space:]]*',''))>=6
       and strpos(lower(l.message_text),regexp_replace(lower(k.payload->>'product_name'),
               '^bantu beres[[:space:]]*[-—]?[[:space:]]*',''))>0
     )
   )
 order by length(k.payload->>'product_name') desc limit 1
), signal as (
 select
   coalesce((select message_text from last_customer),'') as msg,
   (select source_key from explicit_product) as requested_product_id,
   (select product_name from explicit_product) as requested_product_name,
   b.j->'campaign_focus' as focus
 from base b
), decision as (
 select *,
   case
     when lower(msg) ~ '(berhenti|stop|unsubscribe|jangan kirim lagi|stop promo)' then 'OPT_OUT_OR_DECLINE'
     when lower(msg) ~ '(admin|manusia|orang asli|operator|komplain)' then 'HUMAN_REQUEST'
     when lower(msg) ~ '(produk lain|yang lain|pilihan lain)' and requested_product_id is null then 'OTHER_PRODUCT_REQUEST'
     when lower(msg) ~ '(harga|biaya|bayar|berapa|paket|langganan)' then 'PRICE_OR_PACKAGE'
     when lower(msg) ~ '(demo|contoh|lihat tampilan|uji coba)' then 'DEMO_REQUEST'
     when lower(msg) ~ '(beli|checkout|pesan|daftar)' then 'BUYING_QUESTION'
     when lower(msg) ~ '(fitur|manfaat|jelas|cara kerja|guna|untuk apa)' then 'PRODUCT_EXPLANATION'
     else 'GENERAL_REPLY'
   end as customer_intent
 from signal
)
select
 jsonb_set(b.j,'{lead_state}',coalesce(b.j->'lead_state','{}'::jsonb)
    || jsonb_build_object(
       'CS_LAST_CUSTOMER_MESSAGE', d.msg,
       'CS_CUSTOMER_INTENT_HINT', d.customer_intent,
       'CS_PRODUCT_FOCUS',
       case
         when d.requested_product_id is not null
         then jsonb_build_object('product_id',d.requested_product_id,
             'product_name',d.requested_product_name,'basis','CUSTOMER_EXPLICIT_MENTION')
         when d.customer_intent in ('OTHER_PRODUCT_REQUEST','OPT_OUT_OR_DECLINE','HUMAN_REQUEST')
         then 'null'::jsonb
         when jsonb_typeof(d.focus)='object'
         then jsonb_build_object('product_id',d.focus->>'product_id',
             'product_name',d.focus->>'product_name','basis','VERIFIED_SENT_CAMPAIGN')
         else 'null'::jsonb
       end,
       'CS_REPLY_PRIORITY_RULES',
       'Jawab pertanyaan terbaru dahulu. Jika pelanggan menyebut produk tertentu, itu mengalahkan poster/riwayat kampanye. Jika balasan samar dan ada kampanye WAHA yang terverifikasi terkirim, jelaskan hanya produk kampanye tersebut, bukan daftar acak. Poster terkirim bukan bukti pelanggan berminat atau membeli. Jika pelanggan minta produk lain, jangan paksa produk poster: tanyakan kebutuhan. Jika tidak ada produk yang diketahui, tanyakan satu pertanyaan klarifikasi. Hanya jelaskan fitur yang terverifikasi dalam official knowledge. Jangan mengarang harga, diskon, demo, tautan, paket atau status pembayaran. Tanggapi komplain dengan empati dan tawarkan admin; untuk permintaan manusia set needs_human=true. Untuk STOP/penolakan jangan upsell atau follow-up. Satu jawaban fokus, natural, satu CTA bila relevan. Patuhi followup_enabled, opt-out, dan kontrol admin.'
    ),true)
from base b cross join decision d;
$$;

-- The active n8n worker consumes owner instructions from this canonical row.
-- Preserve all existing rules and toggles, especially followup_enabled=false.
update public.bot_settings
set value=to_jsonb(
  $guidance$
PRIORITAS CS V2 — KONTEKS BLASH & JALUR LAYANAN
- Baca CS_LAST_CUSTOMER_MESSAGE, CS_CUSTOMER_INTENT_HINT, CS_PRODUCT_FOCUS, LAST_DELIVERED_CAMPAIGN dan riwayat sebelum memutuskan balasan.
- Saat kontak membalas 'halo', 'coba jelaskan', 'mau tahu', atau pertanyaan samar setelah menerima poster, jawablah tentang produk pada CS_PRODUCT_FOCUS dengan basis VERIFIED_SENT_CAMPAIGN. Jangan sebut tiga produk lain tanpa diminta.
- Jika pesan menyebut produk lain, fokuskan pada produk yang diminta pelanggan. Jika pelanggan mengatakan 'produk lain' tanpa nama, tanyakan kebutuhan terlebih dahulu. Jika pelanggan menolak, jangan memaksa promosi.
- Urutan jawaban: pahami tujuan -> jawab berdasarkan produk resmi -> berikan manfaat konkret yang terverifikasi -> maksimal satu pertanyaan atau CTA yang tersedia. Jangan berulang menyapa, jangan menyalin katalog, jangan bilang 'ada tiga produk utama' kecuali memang diminta melihat katalog.
- Jika harga/promo/link demo tidak ada dalam data resmi, jangan mengarang; jelaskan hal yang diketahui dan bantu cari pilihan selanjutnya. Teks poster sendiri bukan bukti promo saat ini berlaku.
- Jika admin/manusia diminta, set needs_human=true sesuai aturan sistem. Jika pelanggan STOP, jangan upsell dan jangan jadwalkan follow-up.
- Simpan kebutuhan dan preferensi berdasarkan pernyataan pelanggan, bukan simpulan palsu mengenai transaksi. Promosi terkirim menandakan delivered, bukan minat, persetujuan pemasaran, atau pembelian.
- Untuk pertanyaan teknis/jadwal/bug, bantu ringkas masalah dan tindakan yang bisa dilakukan; jangan berjanji telah membuat tiket atau menghubungi admin kecuali sistem benar-benar mencatat tindakan tersebut.
$guidance$ || E'\n\n' || (value #>> '{}')
), updated_at=now()
where key='bot_instructions'
  and jsonb_typeof(value)='string'
  and position('PRIORITAS CS V2' in (value#>>'{}'))=0;

commit;