# Pergantian CS PRIME STORE ke CS2 — STAGED ONLY
**Nomor target:** +62 831-8675-0567 · WAHA `CS2` · `6283186750567@c.us` · LID `208770441470075@lid`.
**Status laporan owner:** STOPPED. Jangan nyalakan pengiriman atau switch sebelum sesi menjadi WORKING dengan identitas WAHA tepat.
**Sesi lama (masih dipakai workflow yang hidup):** `session_01m51sr28e6ytwpjrgyk15aecr` / `6285167465305@c.us`.

## Penting
File JSON di folder ini adalah **referensi saja** dan selalu `active:false`. Jangan impor ulang workflow ke n8n; akan berisiko menggandakan pemrosesan, kredensial dan webhook. Lakukan perubahan di workflow n8n yang sudah berjalan setelah CS2 terverifikasi, menjaga semua node ID/kredensial dan memori pelanggan.

## Langkah cutover setelah CS2 WORKING
1. Periksa `GET /api/sessions/CS2` via WAHA autentikasi: status `WORKING`, name `CS2`, me.id `6283186750567@c.us`; jika field LID ada, cocokkan `208770441470075@lid`. Salah → batal.
2. Jeda Blash dan jangan antrekan pesan baru. Periksa pekerjaan AI dan outbound: tidak boleh ada pending/retry/processing/unknown, dan selesaikan status UNKNOWN secara manual sebelum berpindah (hindari pesan ganda). Jangan jalankan kedua pengirim sekaligus.
3. Pada **workflow aktif n8n yang sama**, edit node `01 | Normalize WAHA Event`: wajib `b.session==='CS2'` dan `b.me?.id==='6283186750567@c.us'`.
4. Edit `03 | Check WAHA Working` agar GET endpoint `/api/sessions/CS2`. Edit `03 | WAHA Working Only` agar mewajibkan status WORKING, name CS2, dan exact me.id. Node kirim tetap mengambil `session` dari status resmi; jangan meng-hardcode pengirim di body. Periksa penggunaan nama node tanpa prefix pada workflow modular.
5. Konfigurasikan WAHA CS2 untuk mengirim `message` dan `message.ack` ke Production URL WAHA Trigger n8n saat ini. Jangan buat webhook kedua yang menggandakan pesan; pastikan akses reverse proxy terautentikasi/private.
6. Periksa HEARTBEAT worker kini menunjukkan sesi CS2. Kirim uji teks ke nomor sendiri, balas dari nomor tersebut, verifikasi AI membaca konteks PRIME STORE dan balas dari akun baru; uji poster Blash. Simulasikan CS2 STOPPED untuk memastikan pengirim fail-closed.
7. Hanya setelah semua lolos, ubah `bot_settings.prime_store_waha_cutover` menjadi `phase=ACTIVE,route_active=true` untuk pencatatan; **metadata tidak mengubah routing n8n**. Sesuaikan pemeriksaan health `WAHA_SESSION` setelah cutover.
8. Pertahankan semua `mc_contact_memories`, kontak, CRM, dan chat historis. Chat @lid baru jangan disamakan dengan nomor lain tanpa bukti provider. Jangan mengirim ulang antrean lama secara otomatis.

## Node patches exact
- Inbound normalizer: `session_01m51sr28e6ytwpjrgyk15aecr` → `CS2`, `6285167465305@c.us` → `6283186750567@c.us`.
- Outbound WAHA Working check URL: `/api/sessions/CS2`.
- Outbound WAHA Working Only: require `$json.status==='WORKING' && $json.name==='CS2' && $json.me?.id==='6283186750567@c.us'`.
- Sender for text/image/video continues to use `$('03 | Check WAHA Working').first().json.name` if all-in-one.

Do not switch the current number while CS2 remains STOPPED.
