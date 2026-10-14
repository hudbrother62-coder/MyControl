# KENDALIKU / My Control — Kandidat WAHA + Groq (14 Oktober 2026)

**STATUS:** Belum diterapkan pada n8n lokal. Semua workflow berstatus **OFF**. Branch ini tidak menyentuh dashboard produksi atau Supabase. Jangan mengaktifkan bot pelanggan sebelum pengujian end-to-end.

## Konsep lama tetap sama

WhatsApp → WAHA session `default` → n8n webhook (Header Auth) → Supabase mc_ingest_whatsapp (dedupe, message, queue) → AI worker Groq (memori per kontak + knowledge resmi) → Supabase outbound queue → WAHA POST /api/sendText → WhatsApp.

My Control web adalah pusat kendali Inbox, customer, mode bot on/off, human takeover, produk dan approval pembayaran. Telegram hanya notifikasi owner (nonblocking). Google Sheets input master; Supabase cache pengetahuan yang dibaca runtime. Data yang sudah ada **tidak direset**.

## Berkas yang siap diimpor (urut)

1. `01-waha-inbound.json` — webhook terautentikasi, filter WAHA, persist + ACK.
2. `02-ai-worker.json` — Groq AI Agent, tools produk/FAQ/promo, memori dan fallback.
3. `03-outbound.json` — kirim dengan WAHA HTTP API, provider message ID, UNKNOWN jika ambigu.
4. `04-followup.json` — dispatch follow-up dan pemulihan lease.
5. `05-readonly-diagnostics.json` — manual, cuma memeriksa API WAHA session dan baca tabel knowledge.

Pilih file JSON melalui n8n → Import from File. **Jangan aktifkan** `workflows/mycontrol.json`, `My Control FINAL v3 - Stable` lama, atau WAHA Trigger tambahan pada nomor yang sama. Jika ingin mempertahankan workflow laporan lama, pastikan trigger/pemrosesan pesannya tidak menggandakan CS baru.

## Konfigurasi lokal Windows (WAHA Docker, n8n proses Windows pada localhost:5678)

Di environment proses n8n: 
- `WAHA_BASE_URL=http://127.0.0.1:3000`
- `WAHA_SESSION=default`
- `SUPABASE_URL=https://vpneonfehqfsxclqcman.supabase.co`
- `GROQ_PRIMARY_MODEL=openai/gpt-oss-120b`
- `GROQ_FALLBACK_MODEL=openai/gpt-oss-20b`
- `N8N_WORKER_ID=mycontrol-n8n-local`

**Wajib isi di environment/credentials lokal, jangan di file JSON, chat, commit atau screenshot:** `WAHA_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, credential `groqApi` untuk 4 Groq Chat Model. Model hanya dipilih jika tersedia dalam akun Groq kamu; jangan anggap akses model dijamin.

Bila n8n dalam container di jaringan Docker WAHA yang sama, gunakan `WAHA_BASE_URL=http://waha:3000` (service name dapat berbeda); jangan gunakan 127.0.0.1 dari container untuk container lain. Konfigurasi environment mesti dibaca oleh *proses n8n* yang aktif (biasanya perlu restart proses).

**Penting:** `NEXT_PUBLIC_SUPABASE_ANON_KEY` berbeda dari `SUPABASE_SERVICE_ROLE_KEY`; service-role hanya di backend.

## Sambungan WAHA yang benar-benar aktif

1. Pastikan `GET /api/sessions/default` dengan `X-Api-Key` memberi `status: WORKING`. Jika 401, perbaiki API key di kredensial/env; **password dashboard `admin` tidak sama dengan API key**.
2. Impor `05-readonly-diagnostics.json` → Execute. WAHA `WORKING` dan Supabase read OK adalah tes koneksi awal, **bukan bukti WhatsApp terkirim**.
3. Di workflow `01`, node Webhook: pilih Credential `Header Auth` baru dengan nama `X-MyControl-Secret` dan nilai secret acak kuat.
4. Konfigurasi session `default` WAHA agar mengirim event **`message` saja** ke **production** webhook n8n: `http://host.docker.internal:5678/webhook/mycontrol/waha/inbound` (WAHA Docker → n8n Windows host). Tambah `customHeaders` dengan nama `X-MyControl-Secret` dan secret sama. Dokumentasi WAHA mendukung customHeaders di per-session webhook.
5. WAHA dapat terhubung ke n8n hanya kalau workflow `01` dipublish/active. Aktifkan `01` sementara untuk tes dengan nomor khusus setelah credential DB dan webhook terbukti. Pertahankan master bot **OFF** agar belum mengirim pesan otomatis.
6. Uji pesan masuk ke tabel inbound/queue, lalu tes `02`, `03` (nomor uji saja), `04` terakhir. Cek sisi WhatsApp penerima dan log DB, bukan semata HTTP 200.

Contoh *struktur*, bukan request yang perlu langsung dikirim (jangan overwrite config session yang sudah ada):
```json
{
  "name": "default",
  "config": {
    "webhooks": [
      {
        "url": "http://host.docker.internal:5678/webhook/mycontrol/waha/inbound",
        "events": ["message"],
        "customHeaders": [
          {"name": "X-MyControl-Secret", "value": "<secret-yang-disimpan-aman>"}
        ]
      }
    ]
  }
}
```

**Jangan langsung PUT config session** tanpa backup: PUT dapat me-restart session dan mengganti konfigurasi webhooks lain. Gunakan dashboard dengan mempertahankan setting lama.

Node WAHA community sudah tampak di menu screenshot, tapi **pemasangan node ≠ sesi WAHA WORKING**. Jalur produksi memakai Webhook + HTTP Request (keduanya langsung ke WAHA yang sama) untuk ACK cepat, kontrol autentikasi dan antrean persisten. Menghubungkan WAHA Trigger kedua secara paralel dapat menggandakan pesan.

## Tes penerimaan wajib

- A. API WAHA dengan key yang benar → HTTP 200 dan status WORKING.
- B. Diagnostic n8n WAHA+Supabase sukses.
- C. 1 WAHA message inbound via webhook diakui setelah `mc_ingest_whatsapp`.
- D. Replay 3x message id yang sama → hanya 1 inbound/AI job.
- E. `fromMe=true`, event grup, event selain `message`, dan sesi berbeda diabaikan.
- F. Groq dapat mengambil history dua kontak berbeda tanpa konteks tercampur; FAQ/produk/jaminan harga hanya dari master resmi.
- G. Keluar melalui `/api/sendText` hanya sekali; provider ID dicatat. WAHA timeout/ambigu => UNKNOWN, jangan kirim ulang buta.
- H. Human takeover mematikan auto-reply dan follow-up untuk kontak tersebut; owner tetap bisa membalas manual.
- I. Bukti bayar/lampiran diserahkan ke admin; *tidak* auto approve pesanan.
- J. Follow-up maksimal 3, berhenti saat dibalas/opt-out/WON/takeover dan mengikuti jam kerja.
- K. Restart WAHA dan n8n tidak menghapus queue; kegagalan Telegram tidak membuat chat WA gagal.
- L. Dashboard My Control menampilkan pesan, status, tindakan operator dan kesehatan sistem yang benar.

**Catatan:** Perubahan ini hanya mengganti integrasi/prompt di workflow. Tampilan lampiran WhatsApp penuh, control bridge Vercel↔localhost dan tes koneksi riil masih membutuhkan verifikasi runtime/dashboard. Jangan klaim LIVE sebelum bukti WAHA/AI/outbound dan deployment dashboard tersedia.

## Pengujian kode

Validasi statis: jumlah node (7,31,9,4), semua edge menunjuk node yang ada, satu inbound webhook dan semua workflow OFF; 4 model Groq menggantikan model Gemini. Tes realistis **belum** dijalankan pada localhost pengguna. Tidak ada secret di JSON.

Referensi:
- WAHA event, webhook, customHeaders: https://waha.devlike.pro/docs/how-to/events/
- WAHA session: https://waha.devlike.pro/docs/how-to/sessions/
- n8n Groq Chat Model: https://docs.n8n.io/integrations/builtin/cluster-nodes/sub-nodes/n8n-nodes-langchain.lmchatgroq/
- Groq model deprecations: https://console.groq.com/docs/deprecations
