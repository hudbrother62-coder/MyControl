# KENDALIKU / MY CONTROL v4 — WAHA Trigger

Paket workflow bot CS, kampanye WhatsApp, CRM per kontak/produk, memori percakapan, balasan manual, takeover, follow-up, teks/video, delivery receipt dan pengecualian kontak dari web.

## File yang diimpor

**Pilihan utama: impor `Kendaliku_MyControl_v3_All_In_One.json`** melalui n8n → Import from file. Ini satu workflow dengan empat jalur trigger yang bekerja lewat database yang sama. Semua file masih nonaktif.

Alternatif untuk monitoring terpisah: impor empat file di `modular/`. Pilih satu cara. Jangan aktifkan versi all-in-one bersamaan dengan empat modular atau workflow lama. Path webhook sama.

## Sebelum mulai

1. Database My Control: `vpneonfehqfsxclqcman`. URL `https://vpneonfehqfsxclqcman.supabase.co`.
2. Migrasi 001–007 sudah ada pada project ini. Migrasi **008_contact_exclusions.sql** juga sudah diterapkan dan diverifikasi pada project ini; migrasi tersebut menambahkan tabel pengecualian dan guard antrean. Periksa migration history; jangan menjalankan ulang migrasi yang sudah terpasang. Salinan SQL disertakan untuk instalasi lain.
3. Koneksi web masih memerlukan `SUPABASE_SERVICE_ROLE_KEY` yang valid di Vercel. URL saja tidak cukup. `/api/health` harus menunjukkan `database.configured=true` dan `database.connected=true` sebelum kontrol web dipakai.
4. WAHA harus menampilkan session `WORKING`. Pastikan endpoint `sendVideo` didukung engine/edisi WAHA yang digunakan; `WAHA_VIDEO_VERIFIED=true` hanya setelah uji video diterima di nomor milik sendiri.
5. Paket memakai node **Groq**, bukan Grok/xAI. Pilih model yang tersedia di akun Groq. Jangan menganggap kuota API tanpa batas. Batas pengiriman dan kebijakan provider tetap berlaku.

## Konfigurasi n8n

Pasang environment server-side berikut, lalu restart n8n agar terbaca:

| Nama | Isi |
| --- | --- |
| SUPABASE_URL | URL project di atas |
| SUPABASE_SERVICE_ROLE_KEY | Service-role key dari project yang sama |
| WAHA_BASE_URL | URL internal WAHA yang bisa dicapai n8n |
| WAHA_API_KEY | API key WAHA |
| WAHA_SESSION | default |
| N8N_WORKER_ID | kendaliku-v3-01 |
| GROQ_MODEL | Model yang benar-benar tersedia di akun |
| WAHA_VIDEO_VERIFIED | false sampai uji video berhasil |

Secrets tidak disertakan dalam JSON. Simpan melalui konfigurasi server/credentials; jangan di browser atau GitHub. Ekspresi `$env` membutuhkan izin pembacaan environment pada instalasi n8n; bila kebijakan server melarangnya, gunakan credential n8n yang setara, tanpa membuka webhook tanpa autentikasi.

Di empat node `Groq ... Credential`, pilih credential Groq milikmu. Satu credential boleh dipakai pada semua slot, tetapi itu bukan tambahan kuota. Slot fallback membantu kegagalan sementara, bukan menghindari batas provider. Web → Automation mengatur model dan instruksi bot.

## WAHA Trigger

File utama kini memakai node resmi **WAHA Trigger** (`@devlikeapro/n8n-nodes-waha.wahaTrigger`, typeVersion 202502, paket sumber 2025.2.9), bukan node Webhook generik.

1. n8n → Settings → Community Nodes → pasang `@devlikeapro/n8n-nodes-waha` jika belum tersedia.
2. Impor file utama, buka node **01 | WAHA Trigger**, salin **Production URL**.
3. Tempel URL itu ke konfigurasi webhook session WAHA; pilih event **message** dan **message.ack**. Trigger ini tetap menerima event melalui URL tersebut; session tidak tersambung otomatis hanya karena file diimpor.
4. Keluaran message (index 1) dan message.ack (index 4) sudah tersambung ke normalisasi. message.any tidak disambungkan untuk menghindari dua rute pesan yang sama. Pesan tetap dideduplikasi oleh ID di database.
5. WAHA Trigger merespons otomatis saat menerima request. Tidak ada node Respond to Webhook dalam file utama. Konsekuensinya ACK tidak menunggu persist database; pantau failed executions agar kegagalan penyimpanan bisa ditangani.
6. Node resmi versi ini tidak menyediakan Header Auth. Batasi akses URL trigger ke WAHA melalui jaringan privat/reverse proxy yang memverifikasi pengirim. Header Auth generik dari file sebelumnya tidak berlaku pada trigger ini.

Versi modular di folder modular masih memakai Webhook generik lama dengan Header Auth. Untuk permintaan ini, gunakan hanya file utama WAHA Trigger; jangan impor/aktifkan versi modular bersamaan.

## Kontrol dari web

- **Kampanye**: pilih produk, penerima berizin, 1–2 bagian teks/video, uji nomor sendiri, mulai/jadwalkan/jeda/batalkan.
- **Kontak → Kontak yang dikecualikan → Kelola pengecualian**: masukkan nomor 08… atau 628… dan alasan. Nomor internal/owner/staf/partner dapat dimasukkan di sini; tidak ada nomor contoh yang otomatis dimasukkan ke produksi.
- **Promosi dan follow-up saja**: kampanye dan follow-up berhenti; bot tetap melayani pertanyaan masuk.
- **Seluruh pesan otomatis**: juga menghentikan balasan bot. Pesan masuk tetap tersimpan; admin tetap bisa membalas manual.
- Pengecualian dicek saat pemilihan penerima, penambahan/claim antrean, sebelum AI, dan tepat sebelum panggilan kirim WAHA. Perubahan setelah permintaan WAHA sudah dimulai tidak dapat menarik kembali pesan yang telah diserahkan ke gateway.
- Menghapus pengecualian tidak memulihkan pesan yang dibatalkan dan tidak memberikan ulang izin promosi pelanggan yang opt-out.
- Nomor dengan format LID tidak dianggap nomor telepon. Pengecualian berbasis nomor hanya cocok pada LID bila ada pemetaan phone yang benar di database. Untuk LID belum terpetakan, pakai human takeover pada chat tersebut sampai pemetaan terverifikasi.
- **Inbox**: riwayat chat, balasan manual, takeover. **CRM**: kebutuhan dan tahap per produk. **Automation**: bot, instruksi, model, follow-up, jeda balasan, URL layanan dan status versi kontrol.

## Empat jalur dalam satu canvas

1. **01 Pesan masuk** — WAHA Trigger → ACK otomatis → normalisasi → dedupe/persist. Receipt delivery menuju pencatat delivery, tidak memanggil AI.
2. **02 Bot CS** — baca kontrol web → claim satu job → cek pengecualian → konteks 30 pesan + memori + produk/kampanye/CRM → Groq + validasi keputusan → antrekan balasan/follow-up. Produk/harga berasal dari knowledge resmi. Kesalahan model masuk retry terbatas; kebutuhan manusia masuk takeover.
3. **03 Pengirim bersama** — baca kontrol web → cek session WAHA → heartbeat → claim satu pesan → siapkan URL video privat bila diperlukan → preflight terbaru → teks/video → receipt → SENT atau UNKNOWN. Balasan admin dan AI diprioritaskan atas kampanye. Satu kontak tidak diproses paralel.
4. **04 Follow-up** — baca kontrol web → dispatch maksimal 25 follow-up due → pulihkan lease worker. Balasan pelanggan, opt-out, takeover dan aturan pengecualian membatalkan otomatisasi terkait.

Pengirim saat ini mengambil **satu job per tick 5 detik**; 1.000 penerima masuk antrean, bukan dijamin terkirim serentak. Dua bagian per kontak dijaga urutannya. Jangan mempercepat dengan loop buta atau menambah banyak worker tanpa pengaturan rate limit provider dan uji beban. Centang biru tidak berarti pengiriman tanpa batas.

SENT berarti gateway mengakui ID pesan; DELIVERED/READ memerlukan event receipt. Timeout/hasil ambigu menjadi UNKNOWN dan tidak dikirim ulang otomatis. Bukti pembayaran bukan persetujuan: owner approval di web tetap wajib. Telegram owner tetap ditangani fitur server web yang sudah ada, bukan webhook tambahan dalam paket ini.

## Urutan uji dan aktivasi

1. Lengkapi database/env dan credentials. Impor workflow dalam keadaan nonaktif.
2. Pilih satu arsitektur; nonaktifkan workflow lama yang memakai webhook/antrean yang sama.
3. Uji inbound ke nomor sendiri, duplikasi event, pesan sendiri/group, bot ON/OFF dan takeover. Pastikan pesan masuk muncul di Inbox.
4. Uji balasan CS dan CRM dari konteks produk resmi. Uji kegagalan Groq tanpa mengirim balasan kosong/karangan.
5. Uji teks dan video masing-masing ke nomor sendiri; cek gateway ID serta perangkat penerima. Baru tandai video terverifikasi.
6. Buat kampanye kecil hanya ke nomor uji yang berizin. Tambahkan pengecualian sebelum mulai dan sesudah pesan mengantre; penerima tersebut tidak boleh mendapat pesan otomatis berikutnya.
7. Uji mode PROMOTION: CS tetap menjawab, promosi berhenti. Uji ALL_AUTOMATION: CS tidak menjawab, inbound tetap tersimpan, manual admin tetap bisa kirim.
8. Uji STOP/opt-out, jeda/batal kampanye, customer membalas sebelum bagian kedua, timeout/UNKNOWN dan restart worker.
9. Setelah seluruhnya lolos di instalasimu, aktifkan workflow pilihan. Paket ini tidak mengaktifkan atau mengirim kampanye secara otomatis.

## Bukti verifikasi

Tes lokal memeriksa koneksi/referensi antar-node, empat trigger, gerbang AI, preflight teks/video, pemisahan nomor/LID, izin service-role, kebijakan pengecualian, pembatalan setelah claim dan larangan menghidupkan ulang job batal. Seluruh tes aplikasi dan build dijalankan sebelum rilis. Ini bukan bukti pengujian impor/runtime n8n, pairing WAHA, atau pengiriman WhatsApp nyata.
