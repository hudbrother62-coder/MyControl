# MyControl / KENDALIKU — n8n Production Pipelines
Tanggal: 13 Oktober 2026. Status: **source prepared, not activated**.

## Kode asal dan kontrak data
Empat file berikut dipisahkan **langsung dari** `workflows/mycontrol.json` (47 node operasional dipertahankan, semua reference dan connection tetap lokal ke masing-masing file):
1. `workflows/production/01-waha-inbound.json` — webhook + normalisasi + dedupe/persist + ACK.
2. `workflows/production/02-ai-worker.json` — durable AI queue, data produk/FAQ/promo, Gemini credential slots, structured decision dan fallback.
3. `workflows/production/03-outbound.json` — durable outbound queue → WAHA → validasi receipt dan status UNKNOWN tanpa blind retry.
4. `workflows/production/04-followup.json` — dispatch follow-up + expired queue lease recovery.

Workflow lama `workflows/mycontrol.json` **tidak dihapus atau diganti**. **JANGAN mengaktifkan webhook asli bersamaan dengan `01-waha-inbound`**; kedua workflow memakai path yang sama sehingga berebut request atau terjadi duplikasi. Empat file baru semuanya `active:false`.

## Kondisi nyata yang masih memblokir aktivasi
- Supabase produksi **My Control** (ref `vpneonfehqfsxclqcman`) dipulihkan menjadi ACTIVE_HEALTHY pada 13 Oktober 2026. Ketiga migrasi `database/001_queue.sql`, `002_reliability.sql`, `003_business_sync.sql` **sudah berhasil diterapkan** dan diverifikasi (9 tabel `mc_*` RLS, 22 fungsi `mc_*` terbatas service role). 20 tabel bisnis asli dan data lama terpelihara.
- Screenshot WAHA lokal `localhost:3000`: worker 1 not connected, 0 session. n8n lokal `localhost:5678` sudah terbuka, belum ada bukti workflow ini diimpor.
- Vercel `my-control` pada commit `c36fa39` terakhir READY, **bukan bukti** database/WAHA/n8n end-to-end sudah berjalan.

## Urutan pemasangan, *setelah* database dan worker pulih
1. Simpan backup n8n credential/encryption key, workflow lama, data Supabase, dan volume WAHA session. Jangan jalankan overwrite volume Docker.
2. Pastikan My Control memakai project Supabase `vpneonfehqfsxclqcman`; proyek awal KENDALIKU `jhlgihzrtutsctzwcdqt` adalah **database lain** dan tidak boleh dimigrasi silang tanpa peta data yang disetujui.
3. Verifikasi ulang tiga migrasi yang **sudah terpasang** menggunakan Supabase Migration History dan tabel `mc_*`; jangan menjalankan ulang migrasi tanpa alasan. Lanjutkan tes RPC PostgREST, pengamanan service-role, dan bot toggle sebelum aktivasi trigger.
4. Hubungkan WAHA worker dengan API key di Dashboard `http://localhost:3000/dashboard/`, buat session `default`, QR pairing sampai `WORKING`.
5. Impor ke n8n keempat file JSON, **biarkan inactive**. Konfigurasikan environment **server-side**: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `WAHA_BASE_URL`, `WAHA_API_KEY`, `WAHA_SESSION=default`, `N8N_WORKER_ID`, `GEMINI_PRIMARY_MODEL`, `GEMINI_FALLBACK_MODEL`. Pilih Gemini credentials di masing-masing model node sesuai kapasitas yang benar-benar tersedia. Model IDs dalam environment harus cocok dengan akses provider; jangan berasumsi `gemini-3.5-flash` tersedia.
6. Di n8n inbound Webhook set credential Header Auth: `X-MyControl-Secret` dengan secret yang kuat. WAHA Webhook harus mengirim header yang sama **jika versi WAHA mendukung custom headers**. Jika tidak, gunakan reverse proxy internal untuk menambahkan autentikasi; jangan membuat webhook publik tanpa autentikasi.
7. Untuk WAHA **Docker Desktop** → n8n **Windows host**, production webhook dari sisi container: `http://host.docker.internal:5678/webhook/mycontrol/waha/inbound`. Jika n8n juga container dalam network bersama, gunakan nama layanan Docker seperti `http://n8n:5678/webhook/mycontrol/waha/inbound`. Untuk n8n container → WAHA container gunakan `WAHA_BASE_URL=http://waha:3000`; jika n8n Windows host → Docker-published WAHA gunakan `http://127.0.0.1:3000`.
8. Pastikan hanya **satu** webhook WAHA session `default` untuk event `message`, dan **jangan memakai** file chatbot generik yang dibuat sebelumnya. Tes dulu inbound secara terisolasi dengan test number. Setelah terbukti, aktifkan AI worker, outbound, lalu follow-up secara bertahap.
9. Uji: inbound/replay x3/fromMe/group, queue persistence, provider 429/timeout & fallback, output JSON invalid, WhatsApp receipt ambiguous, takeover manual, pembayaran owner approval, opt-out dan pembatalan follow-up, restart n8n/WAHA, Telegram gagal tidak menggagalkan balasan, serta detail tiap conversation tidak tercampur.
10. Jika ada kegagalan, hentikan aktivasi prod. Semua status harus menyatakan *database inactive / worker disconnected / untested* secara akurat. **Jangan** mengklaim pesan terkirim hanya dari respons API `SENT`; cek perangkat penerima/receipt.

## Aturan bisnis yang wajib tetap berlaku
- AI hanya menjawab berdasarkan Product/Promotion/FAQ/Bot Settings resmi, tidak mengarang harga, diskon, demo URL, testimoni, stok, atau kebijakan.
- `owner_approval_required=true`. Bukti transfer bukan konfirmasi pembayaran dan produk digital hanya dikirim sesudah owner approve.
- Human takeover menonaktifkan auto-reply dan follow-up customer terkait (default 60 menit).
- Maksimal tiga follow-up, otomatis berhenti saat customer membalas/menolak/opt-out, sudah WON/paid, nomor blocked, atau takeover.
- Operasional reply/follow-up mengikuti pengaturan; jam kerja default 08:00–22:00 Asia/Jakarta. **Laporan otomatis jam 22:00 sebelumnya diminta dihentikan**; jangan hidupkan scheduler laporan tanpa instruksi baru.
- Tidak ada secret di frontend, file JSON, commit, atau log. Jangan pernah melakukan retry buta pesan WAHA yang hasil kirimnya tidak jelas.
- Google Sheets adalah master input; runtime membaca cache/knowledge Supabase, bukan membaca Google Sheets setiap pesan.

## Pemeriksaan statis yang tersedia
`npm test` termasuk `tests/workflow-separation.cjs`: memastikan 47 node sumber dipertahankan, tepat satu trigger per workflow, semua edges/references lokal, webhook WAHA unik, dan outbound tidak memanggil AI ulang.

**Penting:** lulus test ini tidak memverifikasi bahwa n8n bisa mengimpor workflow pada versinya atau bahwa model/WAHA/Supabase aktif. Runtime acceptance wajib tersendiri.

## Prioritas lanjutan
P0: pulihkan Supabase + WAHA worker + session dan buktikan inbound/dedupe/outbound.
P1: uji owner approval/human takeover/followup/failover/Telegram dan health dashboard.
P2: katalog Google Sheets → snapshot knowledge Supabase, analitik penjualan, UX mobile + dark/light.
