# Pemulihan sesi WAHA CS2 — My Control Blash (24 Oktober 2026)

## Sumber kebenaran
- WAHA session sekarang: **CS2** (sebelumnya CSNEW2).
- WAHA `me.id` dan `me.lid` **tidak berubah**; harus cocok dengan pemeriksaan identitas yang sudah ada.
- Proyek n8n: **KENDALIKU v4**, workflow yang telah aktif di server. Jangan impor ulang menjadi duplikat dan jangan mengaktifkan salinan modular bersamaan.
- AI Auto Reply dan Follow-up tetap OFF; worker outbound adalah satu-satunya jalur yang perlu dipulihkan.

## Perubahan yang sudah disiapkan di GitHub
- `workflows/release/Kendaliku_MyControl_v3_All_In_One.json`
  - `01 | Normalize WAHA Event`: terima event dengan `b.session === 'CS2'`.
  - `03 | Check WAHA Working`: `GET /api/sessions/CS2`.
  - `03 | WAHA Working Only`: pastikan `WORKING`, `name === 'CS2'`, serta `me.id` dan `me.lid` tetap cocok.
- Versi modular `workflows/production/01-waha-inbound.json` dan `03-outbound.json` sudah disejajarkan.
- `database/068_waha_cs2_session_same_number.sql`: pembaruan konfigurasi target, draft tanpa job, dan fungsi pembuatan kampanye berikutnya.

## Wajib diterapkan di n8n yang sudah berjalan
Repo dan deploy Vercel **tidak otomatis memperbarui workflow n8n yang tersimpan di server**.
1. Buka `https://kerjabanter.duckdns.org` > workflow yang telah aktif `sBxYeXeIGD2OvaLV` > edit tiga node **dalam workflow yang sama** (bukan mengimpor workflow baru).
2. Pastikan ekspresi URL `03 | Check WAHA Working` berakhir dengan `/api/sessions/CS2`. Pada node `03 | WAHA Working Only` syarat nama sesi harus `CS2`; pemeriksaan `me.id` dan `me.lid` jangan dibuang.
3. Pada `01 | Normalize WAHA Event`, gunakan `b.session === 'CS2'`. Pastikan konfigurasi WAHA `CS2` mengirim webhook ke URL produksi workflow inbound yang sama.
4. Simpan dan **publish** pembaruan pada workflow n8n yang semula aktif. Tinjau eksekusi terbaru pada tiga node tadi.
5. Dari Supabase cek `mc_campaign_runtime.session_name='CS2'` mempunyai `last_seen` aktual < 90 detik dan `image_supported=true` untuk pengiriman poster. **Jangan pernah memperbarui `last_seen` secara manual.**
6. Uji satu pesan ke nomor WhatsApp milik sendiri, periksa `mc_outbound_jobs` dan tanda terima WAHA. Hanya setelah uji terverifikasi lanjutkan pengiriman kampanye dengan persetujuan pelanggan.

## Validasi database tanpa melakukan Blast
```sql
select now() as checked_at,session_name,worker_id,image_supported,last_seen,
       round(extract(epoch from(now()-last_seen))) as age_seconds
from public.mc_campaign_runtime
where session_name='CS2';

select id,name,status,session_name from public.mc_campaigns
where name='3 tiga' order by created_at desc limit 1;
```

**Jangan memulai 90 pengiriman otomatis** hanya karena sesi CS2 tampak WORKING di panel WAHA. Pemeriksaan heartbeat worker, webhook, dan uji nyata harus benar.
