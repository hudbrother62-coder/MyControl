# My Control — Kampanye WhatsApp, CRM, dan Kendaliku

Tanggal: 16 Oktober 2026 · Zona operasional: Asia/Jakarta
Status: rancangan untuk ditinjau; belum diimplementasikan atau diuji pada produksi.

## 1. Tujuan dan dasar keputusan

Owner dapat memilih sampai 1.000 kontak dalam satu kampanye promosi, mengirim video dengan caption atau urutan dua pesan, lalu menyerahkan balasan rutin kepada bot dengan memori per kontak. Owner memantau hasil dan menangani pengecualian dari My Control yang sudah ada.

Keberhasilan diukur melalui pengiriman yang dapat ditelusuri, balasan yang terhubung ke kontak dan produk yang benar, tidak ada pengiriman ulang buta, pengambilalihan admin yang konsisten, serta pembayaran yang terverifikasi. Tidak menjanjikan pengiriman tanpa batas atau semua pesan pasti dibaca.

Dasar yang telah dibaca pada sesi ini:
- Blueprint Kendaliku/MyControl 13 Oktober 2026, 214 baris.
- Repo `hudbrother62-coder/MyControl`, default branch `main`, akses push tersedia.
- `components/Shell.tsx`: sepuluh menu; navigasi mobile saat ini menampilkan seluruh menu.
- `app/sales/page.tsx`: NEW/FOLLOW_UP/PENDING/STALE/CLOSING/LOST; empat kolom awal dan tabel closing/lost.
- `app/automation/page.tsx`: toggle bot, AI, takeover, approval; pengaturan delay dan follow-up.
- `package.json`: Next.js 15, React 19, Supabase; script typecheck, test, build, test:http.

Informasi historis, belum diverifikasi ulang pada database/live deployment: proyek Supabase MyControl `vpneonfehqfsxclqcman`; Vercel `my-control`; empat workflow inti n8n. Domain dan layanan VPS dilaporkan sudah berhasil oleh owner; URL baru, versi WAHA, dan kesehatan runtime belum diuji pada sesi ini.

Tidak membuat aplikasi atau database pengganti. Migrasi domain/infrastruktur bukan fokus fitur ini. AI pada blueprint menggunakan Groq, bukan Grok/xAI; provider aktual harus diperiksa sebelum konfigurasi diubah.

## 2. Pendekatan yang dipilih

1. Rekomendasi: perluas My Control, pakai database yang sama, antrean tahan restart, konektor pengirim terpisah. Menjaga riwayat lama dan memungkinkan WAHA diganti tanpa mengubah CRM.
2. Menaruh seluruh CRM dan antrean dalam eksekusi n8n: lebih cepat untuk demo tetapi sulit menjaga deduplikasi, progres, dan pengambilalihan admin. Tidak dipilih.
3. Mengganti aplikasi dengan CRM pihak ketiga: mengurangi pekerjaan awal tetapi menambah migrasi dan mengubah alur owner. Tidak dipilih.

Nomor centang biru tidak membuktikan koneksi API resmi. UI menampilkan jenis koneksi sebenarnya: WAHA atau Business Platform resmi. Kemampuan video, status delivery, template, dan kapasitas ditentukan hasil pemeriksaan konektor, bukan badge akun. Nomor yang sama tidak diasumsikan bisa dipasang bersamaan di dua konektor tanpa proses migrasi/coexistence yang didukung.

## 3. Struktur menu dan desain visual

Navigasi utama desktop: Ringkasan, Kampanye, Inbox, Kontak, CRM. Grup Bisnis: Produk, Pesanan, Pembayaran, Laporan. Grup Sistem: Bot & Otomasi, Integrasi, Pengaturan. Route lama dipertahankan; `/sales` ditampilkan sebagai CRM.

Mobile hanya lima tombol bawah: Ringkasan, Kampanye, Inbox, CRM, Lainnya. Kontak dan pengaturan masuk Lainnya. Tombol mempunyai label, area sentuh minimal 44px, indikator aktif, dan safe-area. Detail ditampilkan satu layar per langkah dengan tombol kembali; tidak memaksakan tiga panel desktop ke HP.

Tema terang/gelap mengikuti branding Bantu Beres yang ada. Gunakan satu warna aksen utama; hijau untuk keberhasilan terkonfirmasi, kuning untuk menunggu/perlu tindakan, merah untuk gagal. Semua status disertai teks/ikon. Grid 8px, radius konsisten, angka mudah dibaca, shadow hanya pada panel melayang. Tidak menampilkan data simulasi sebagai data operasional.

Setiap halaman memiliki state memuat, kosong dengan langkah berikutnya, gagal dengan tindakan ulang, dan sukses. Form menyimpan draft; perubahan belum tersimpan terlihat. Pencarian server-side, pagination, filter tersimpan di URL; hindari memuat semua pesan setiap refresh. Akses keyboard, fokus dialog, label input, dan kontras diperiksa.

## 4. Ringkasan operasional

Header: status koneksi dan waktu pemeriksaan terakhir, tombol Buat Kampanye.
Empat kartu: kampanye berjalan, kontak membalas, perlu admin, pembelian terverifikasi.
Panel utama: progres kampanye aktif dan daftar percakapan perlu tindakan; panel sekunder: follow-up jatuh tempo dan gangguan integrasi.

Setiap metrik menyebut rentang tanggal. Kartu bisa diklik menuju daftar yang membentuk angkanya. Status bot global dan tombol hentikan pengiriman otomatis terlihat tanpa membuka pengaturan.

## 5. Kampanye: alur lima langkah

### A. Produk dan tujuan
Nama kampanye, produk utama, koneksi pengirim, tujuan CTA, penanggung jawab. Satu kampanye punya satu produk utama agar bot mempunyai konteks awal jelas; pelanggan boleh berpindah produk dalam percakapan.

### B. Penerima
Pilih segmen atau import CSV/XLSX. Pemetaan kolom nama/nomor/label/sumber/izin promosi. Normalisasi nomor menjadi E.164 menggunakan aturan negara yang eksplisit, deduplikasi, preview data valid/duplikat/tidak valid/tidak memenuhi izin. Simpan alasan setiap baris yang dikecualikan. Import tidak otomatis membuktikan nomor terdaftar WhatsApp.

Default kirim hanya kontak dengan izin promosi tercatat. Kontak berhenti berlangganan selalu dikecualikan meski baru diimpor ulang. Daftar penerima dibekukan saat kampanye dijadwalkan, tetapi izin dan larangan kontak diperiksa lagi saat kirim.

### C. Pesan
Mode 1: video + caption. Mode 2: teks pembuka, kemudian video + caption. Editor mendukung variabel terbatas seperti `{{nama}}`, fallback sapaan, preview per penerima, penghitung panjang, dan pengecekan link. Placeholder yang tidak terisi menghalangi penjadwalan.

Unggah video satu kali ke penyimpanan privat. Periksa MIME, ukuran, durasi/codec sesuai kemampuan konektor aktual. Worker memakai URL akses terbatas yang masih berlaku saat mengambil media; jangan menyimpan URL kedaluwarsa sebagai satu-satunya sumber. Video tidak disalin untuk setiap penerima. Format template resmi dipilih bila konektor mensyaratkan.

### D. Bot dan tindak lanjut
Tentukan knowledge produk Published, gaya bahasa, kapan eskalasi, dan aktif/tidaknya bot untuk balasan kampanye. Default bot menjawab saat pelanggan membalas; tidak mengirim pesan tambahan hanya karena kampanye selesai. Follow-up proaktif default OFF. Jika diaktifkan, owner memilih jadwal dan batas, default maksimal satu; batas sistem maksimum tiga per siklus penjualan sesuai blueprint.

### E. Tinjau dan jadwalkan
Ringkasan jumlah penerima, jumlah bagian pesan, konektor, konten, jadwal WIB, status bot, dan estimasi biaya hanya jika tarif diketahui. Kirim uji ke nomor milik owner; jadwal produksi baru tersedia setelah tes konten/media berhasil. Tombol final menyatakan jumlah penerima secara eksplisit.

Kampanye: DRAFT → SCHEDULED → RUNNING → COMPLETED; PAUSED dapat dilanjutkan; CANCELLED terminal. COMPLETE berarti antrean sudah mencapai hasil terminal, bukan semua penerima sukses. Jika masih UNKNOWN atau retry tertunda, tampilkan perlu rekonsiliasi, bukan sukses.

Setelah mulai, konten dan daftar penerima immutable. Perubahan menjadi kampanye/versi baru, sehingga audit tidak berubah diam-diam.

## 6. Detail kampanye dan laporan

Header: nama, produk, progres, jeda/lanjutkan/batalkan. Tab Ringkasan, Penerima, Balasan, Aktivitas.
Tabel penerima: nama, nomor, progres pesan 1/2, status terakhir, balasan, tahap CRM, tindakan buka chat. Mobile menampilkan nama dan status; detail melalui panel.

Pengukuran terpisah:
- Pengiriman per pesan: QUEUED, CLAIMED, ACCEPTED, DELIVERED, READ, FAILED, UNKNOWN, SKIPPED, CANCELLED.
- Penerima: belum diproses, sebagian terkirim, seluruh bagian diterima gateway, gagal, belum pasti.
- Balasan per kontak unik; reply rate = kontak membalas / kontak dengan setidaknya satu pesan DELIVERED, hanya jika data delivery memadai. Bila tidak, tampilkan rasio terhadap accepted dengan label jelas.
- Pembelian dan nilai omzet hanya dari order/payment terverifikasi, disertai aturan atribusi.

ACCEPTED berarti gateway menerima; bukan bukti sampai ke pelanggan. READ tidak diasumsikan ada jika receipt tidak tersedia. Event terlambat tidak menurunkan READ menjadi DELIVERED. Simpan waktu provider dan waktu penerimaan webhook.

## 7. Inbox dan bot Kendaliku

Desktop: daftar chat di kiri, percakapan di tengah, detail CRM di kanan. Mobile: daftar → percakapan → detail. Filter: Semua, Belum dibaca, Ditangani bot, Perlu admin, Menunggu pelanggan. Badge kampanye/produk, status bot/admin, waktu balasan terakhir terlihat.

Panel detail: profil, izin promosi, produk diminati, peluang penjualan, ringkasan, catatan, follow-up, kampanye terkait, order. Tombol Ambil Alih dan Kembalikan ke Bot berada dekat composer. Pesan admin menetapkan takeover persisten. Bot tidak dapat membuka takeover sendiri.

Konteks AI: identitas kontak → izin/opt-out/takeover → state produk/order → fakta terkonfirmasi dan riwayat → kampanye yang relevan → knowledge Published. Maksud CRM adalah data terstruktur, bukan menyalin semua tabel ke prompt. Harga/link dari katalog; pembayaran dan fulfillment tetap diverifikasi sistem/admin.

Balasan ke pesan tertentu ditautkan melalui provider message ID. Jika tidak ada kutipan, gunakan kandidat kampanye terbaru yang relevan sebagai konteks, bukan bukti pasti. Bila ada dua produk yang mungkin, bot bertanya produk yang dimaksud. Catat atribusi `direct`, `inferred`, atau `unknown`.

Pesan cepat dari satu kontak digabung melalui debounce pendek dan dapat dikonfigurasi; satu kontak diproses berurutan, banyak kontak diproses paralel sesuai kapasitas. Simpan conversation_version. Sebelum kirim, periksa bahwa versi, takeover, dan izin masih sama; jawaban lama dibatalkan dan dihitung ulang bila diperlukan.

AI menghasilkan usulan reply, intent, produk, stage, fakta, dan eskalasi dalam JSON tervalidasi. AI tidak mempunyai akses perubahan database bebas. Jika model gagal/429, antrekan ulang sesuai Retry-After atau eskalasi; jangan memberi jawaban karangan. Circuit breaker menghentikan kegagalan berulang dan menampilkan gangguan.

Berhenti promosi dibedakan dari permintaan bantuan: opt-out memblokir kampanye/follow-up, namun pelanggan tetap boleh meminta layanan; bot tidak menyisipkan promosi pada percakapan layanan tersebut. Permintaan berhenti seluruh komunikasi otomatis dihormati sesuai cakupannya.

## 8. Kontak dan CRM

Kontak adalah satu orang; peluang penjualan adalah satu kontak × produk × siklus penjualan. Satu orang dapat mempunyai beberapa peluang tanpa menggandakan identitas.

Kolom CRM yang disarankan: Baru, Menggali kebutuhan, Tertarik, Follow-up, Menunggu pembayaran, Menang, Tidak lanjut. Status tidak membalas bukan otomatis tidak berminat. Pipeline mobile default daftar berfilter; kanban opsional untuk desktop.

Detail peluang: produk, kebutuhan, keberatan, nilai penawaran, sumber kampanye, stage dan riwayat perubahan, tindakan berikutnya, order terkait. AI boleh mengusulkan/mengisi stage non-finansial dengan sumber pesan. Status Menang hanya dari pembelian terverifikasi atau keputusan admin yang diaudit, bukan kata 'sudah transfer'.

Riwayat lama tetap disimpan. CLOSING lama tidak langsung dikonversi menjadi pembelian berhasil; perlu bukti order/payment atau peninjauan. Mapping awal: NEW→Baru, FOLLOW_UP→Follow-up, PENDING→Menggali kebutuhan dengan status migrasi perlu tinjau, STALE→stage lama plus label Tidak aktif, LOST→Tidak lanjut, CLOSING→Menunggu pembayaran/perlu tinjau. Jangan menghapus makna asli; simpan legacy_status.

## 9. Antrean dan integrasi

My Control: UI + API bisnis terautentikasi. Supabase: sumber data dan antrean. n8n di VPS: orkestrasi. WAHA/adapter resmi: transport. Groq/provider yang terkonfigurasi: inferensi AI.

Pertahankan workflow inti inbound, AI, outbound, follow-up. Tambah scheduler kampanye yang memasukkan job ke antrean outbound yang sama; jangan membuat dua jalur pengirim yang saling bersaing. Prioritas awal: admin dan reply pelanggan mendahului blast, dengan penjadwalan adil agar blast tetap berjalan.

Kunci unik pengiriman: kampanye + penerima + bagian pesan. Claim job atomik dengan lease, attempt, next_attempt_at, worker_id. Dua worker tidak mengambil job sama. Bagian kedua dikirim setelah bagian pertama accepted dan hasilnya pasti; hentikan bagian kedua bila pelanggan membalas lebih dulu, opt-out, atau admin takeover.

Kegagalan sebelum request dikirim boleh retry terkontrol. Timeout setelah kemungkinan accepted → UNKNOWN, lakukan rekonsiliasi provider message ID/event/history bila didukung. Bila tidak bisa dibuktikan, minta tinjau; jangan blind retry. Tidak menjanjikan exactly-once pada transport eksternal; deduplikasi internal dan rekonsiliasi mengurangi duplikasi.

Webhook diverifikasi memakai kemampuan konektor, batas replay, dedupe event, lalu ACK cepat setelah commit. ACK delivery tidak menjalankan AI; pesan fromMe/grup/status tidak menjadi input bot customer. Jika signature tidak tersedia, gunakan secret header dan pembatasan jaringan sesuai deployment.

Heartbeat menampilkan WORKING/DEGRADED/STALE/OFFLINE beserta last_seen. Koneksi tidak dinyatakan sehat hanya karena URL/key tersimpan. Ketika WhatsApp offline, blast pause otomatis dan admin mendapat pemberitahuan di aplikasi. Cadangan workflow mempertahankan encryption key n8n dan volume session WAHA.

## 10. Data tambahan dan kontrak API

Nama berikut usulan konseptual, wajib dicocokkan dengan skema aktual sebelum SQL dibuat:

| Entitas | Fungsi dan kunci penting |
|---|---|
| mc_campaigns | produk, akun pengirim, versi konten, state, jadwal, actor |
| mc_campaign_steps | urutan, tipe teks/video, caption, media_id, template |
| mc_campaign_recipients | contact_id, snapshot variabel, state, alasan skip; unik campaign/contact |
| mc_contact_consents | cakupan izin, sumber, waktu pemberian/pencabutan; import tidak menghapus pencabutan |
| mc_import_batches | sumber file, mapping, validasi, ringkasan, jejak baris bermasalah |
| mc_media_assets | object key, checksum, MIME, ukuran, hasil validasi, retensi |
| mc_opportunities | contact/product/siklus, stage, legacy_status, order_id |
| mc_activity_events | audit actor, aksi, target, waktu, sumber pesan |

Perluas queue outbound dan delivery yang sudah ada dengan campaign_id, recipient_id, step_id, conversation_version, idempotency_key, lease, attempt, next_attempt_at. Reuse identitas/memori/follow-up yang ada jika audit membuktikan fungsinya sama. Jangan membuat tabel paralel tanpa kebutuhan.

API bisnis yang direncanakan: preview/commit import, create/update draft, validate campaign, send test, schedule, pause, resume, cancel, list recipients, read contact timeline, update opportunity, takeover/return-to-bot. Gunakan namespace API yang konsisten dengan repo. Mutasi memerlukan sesi owner/operator yang berwenang, validasi server-side, idempotency key untuk aksi pengiriman, dan optimistic version untuk edit bersamaan. API tidak menerima status PAID dari AI.

Kontak dan pesan hanya diakses owner/anggota workspace yang diizinkan. Seluruh operasi membawa scope workspace/account yang tervalidasi. RLS/grant dan proxy service-role diaudit; jangan membuka semua tabel untuk authenticated. Kunci API hanya server-side; media privat; log tanpa secret dan isi chat yang tidak diperlukan.

## 11. Migrasi aman dari sistem lama

1. Inventaris latest commit, deployment production, skema/fungsi/grant/RLS aktual, workflow aktif, konfigurasi provider dan storage. Temuan keamanan blueprint lama adalah hipotesis audit ulang, bukan bukti keadaan sekarang.
2. Backup database, ekspor workflow dan konfigurasi terenkripsi; pastikan restore diuji di lingkungan terpisah. Jangan reset akun, pesan, volume, atau domain.
3. Migrasi additive: tabel/kolom/index baru, feature flag Kampanye OFF. Hindari rename/drop kolom lama pada rilis pertama.
4. Backfill kontak dan alias secara batch idempotent. JID/LID tidak dipaksa sebagai nomor; identitas ambigu masuk antrean peninjauan. Simpan mapping ID lama→ID kanonis dan provenance penggabungan.
5. Backfill lead menjadi peluang dengan legacy_status dan pemeriksaan khusus CLOSING. Riwayat pesan tetap tersambung ke ID yang benar. Cocokkan jumlah record, orphan, checksum terpilih, dan contoh percakapan.
6. Deploy API yang kompatibel dengan UI lama. Gunakan satu jalur penulisan kanonis dengan adapter sementara; hindari dual-write yang tidak atomik.
7. Aktifkan pembacaan baru untuk owner dalam mode terbatas. Migrasi workflow versi baru pada allowlist; workflow lama tidak boleh menanggapi event yang sama bersamaan.
8. Uji end-to-end dengan nomor owner dan penerima uji yang mengizinkan. Naikkan volume hanya setelah hasil lulus; 1.000 kontak uji sintetis tidak mengirim ke pelanggan.
9. Aktifkan fitur bertahap, pantau error/lag/UNKNOWN/duplikasi/biaya. Tetapkan rollback ke app sebelumnya, matikan scheduler baru, simpan data baru untuk rekonsiliasi. Jangan menghapus job yang sudah accepted atau mengirim ulang ketika rollback.
10. Setelah stabil, arsipkan adapter lama dalam rilis terpisah. Penghapusan data/schema tidak menjadi bagian rilis fitur pertama.

## 12. Pengujian dan syarat siap produksi

Semua kasus berikut masih BELUM DIJALANKAN pada sesi desain ini.

| Kasus | Hasil wajib |
|---|---|
| Import 1.000 baris dengan duplikat/nomor salah/opt-out | Jumlah cocok; duplikat dan penerima tidak layak tidak dikirim |
| Dua worker mengambil job yang sama | Satu claim berhasil |
| Event inbound diulang tiga kali | Satu pesan, maksimal satu keputusan balasan aktif |
| Video sukses dan gagal | Preview benar; kegagalan tercatat per bagian; teks tidak diulang buta |
| Timeout setelah gateway menerima | UNKNOWN lalu rekonsiliasi; tanpa retry otomatis buta |
| Kontak membalas saat blast berjalan | Reply mendapat prioritas; bagian lanjutan promosi kontak itu dibatalkan |
| Dua kampanye ke kontak yang sama | Tidak interleave tanpa kendali; atribusi ambigu tidak ditebak pasti |
| 1.000 kontak uji paralel melalui simulator | Tidak ada kebocoran konteks, duplikasi job, atau kehilangan pesan; ukur p50/p95 dan queue lag |
| Model 429/timeout/JSON rusak | Backoff atau eskalasi; tidak ada jawaban palsu |
| Admin takeover saat AI berpikir | Hasil usang tidak dikirim; batas pesan in-flight dicatat |
| STOP ketika follow-up sudah antre | Job promosi tersisa dibatalkan; re-import tidak membuka blokir |
| Bukti transfer via chat | Tidak otomatis PAID |
| Restart n8n/WAHA | Lease pulih; pekerjaan accepted tidak dikirim ulang |
| Event delivery datang terbalik | READ tidak turun status; histori tetap tersimpan |
| Sesi tanpa izin / akses kontak workspace lain | 401/403; tidak ada data bocor |
| HP 360/390px dan desktop; tema terang/gelap | Navigasi dan composer tidak tertutup keyboard; tidak ada overflow halaman |
| Backup/restore dan rollback | Data lama tetap utuh; tidak ada blast ganda |
| Produksi | Typecheck, test, build, smoke lulus; Vercel READY dan SHA cocok; kirim-terima nyata terbukti |

Uji beban dilakukan terhadap adapter simulator, bukan 1.000 pesan nyata. Catat kapasitas nyata provider/AI/VPS sebelum menjanjikan latency. Target awal internal p95 persist inbound <2 detik dan respons bot <15 detik pada beban uji yang disepakati; ini target, bukan hasil ukur atau SLA. Batas resmi/provider selalu lebih tinggi prioritasnya daripada target internal.

## 13. Urutan implementasi

P0: audit keamanan, identitas, backup, jalur outbound tunggal, dedupe, takeover, consent, heartbeat.
P1: Kampanye + Kontak + media + antrean, preview/test send dan laporan pengiriman.
P1: Inbox/CRM terpadu, konteks kampanye pada bot, produk Published, pencatatan aktivitas.
P1: follow-up bersyarat dan laporan konversi dengan atribusi yang transparan.
P2: penyempurnaan produktivitas, segmentasi lanjutan, pemilihan konektor resmi setelah kebutuhan terbukti.

Tidak memasukkan A/B testing, AI scoring rumit, multi-agent penjualan, atau desain ulang pembayaran di rilis pertama. Semua fungsi inti blast–reply–CRM diprioritaskan sebelum dekorasi.

## 14. Keputusan operasional yang dibawa ke audit

- URL My Control yang diketahui: https://my-control-snowy.vercel.app/; domain baru perlu dipetakan tanpa mengubah DNS.
- Koneksi default menggunakan yang benar-benar tersedia dan lolos tes; badge centang biru bukan penentu konektor.
- Kontak tanpa bukti izin dapat disimpan/dibersihkan, tetapi tidak otomatis masuk penerima promosi.
- Bot reply aktif per kampanye hanya setelah allowlist test; follow-up proaktif default OFF.
- Data dan integrasi lama dipertahankan; tidak menghapus akun atau membuat Supabase baru.
- Desain ini perlu ditinjau sebelum menulis rencana implementasi rinci dan mengubah produksi. Belum ada perubahan kode, database, workflow, atau pengiriman nyata pada sesi ini.

## 15. Referensi

- Repo: https://github.com/hudbrother62-coder/MyControl
- Kebijakan WhatsApp: https://business.whatsapp.com/policy
- WAHA events: https://waha.devlike.pro/docs/how-to/events/
- WAHA video dan kemampuan konektor: https://waha.devlike.pro/docs/how-to/send-messages/
- Groq rate limits: https://console.groq.com/docs/rate-limits
- Supabase API security: https://supabase.com/docs/guides/api/securing-your-api

Referensi platform harus diverifikasi ulang sebelum implementasi; spesifikasi ini bukan sertifikasi kepatuhan atau bukti kemampuan instalasi aktual.
