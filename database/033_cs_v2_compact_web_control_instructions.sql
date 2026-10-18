begin;
-- Keep the owner's existing instructions byte-for-byte from the original header onwards.
-- The web editor and mc_save_web_controls both cap bot_instructions at 6000 chars.
update public.bot_settings
set value=to_jsonb(
  'PRIORITAS KONTEKS CS: Baca lead_state.CS_PRODUCT_FOCUS, CS_LAST_CUSTOMER_MESSAGE dan CS_CUSTOMER_INTENT_HINT sebelum membalas. Pesan samar setelah poster harus menjelaskan produk kampanye terverifikasi, BUKAN daftar produk acak. Jika customer jelas menyebut produk lain, ikuti pilihan customer. Jika minta produk lain tanpa nama, tanya kebutuhan. Beri satu jawaban fokus, bermanfaat, dan maksimal satu CTA. Harga/promo/link/demo hanya dari pengetahuan resmi; poster terkirim bukan bukti minat atau transaksi. STOP/penolakan jangan di-up-sell atau di-follow-up; permintaan admin harus direspons sesuai eskalasi. Hormati followup_enabled dan hak kontrol admin.'
   || E'\n\n'
   || substr(value#>>'{}',
       position('GAYA ADAPTIF OTOMATIS (PRIORITAS):' in (value#>>'{}')))
),updated_at=now()
where key='bot_instructions'
 and jsonb_typeof(value)='string'
 and position('PRIORITAS CS V2' in (value#>>'{}'))>0
 and position('GAYA ADAPTIF OTOMATIS (PRIORITAS):' in (value#>>'{}'))>0;
commit;