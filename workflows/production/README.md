# KENDALIKU / MY CONTROL — workflow v3

Rilis 16 Oktober 2026. Empat alur ini menjalankan bot CS Groq, pesan massal teks/video, CRM/memori per kontak, balasan manual dan follow-up melalui antrean Supabase yang sama.

- `01-waha-inbound.json`: webhook terautentikasi, normalisasi, dedupe, persist, delivery receipt.
- `02-ai-worker.json`: kontrol web, pengecualian kontak, konteks/memori/produk/CRM, Groq, validasi, antrean balasan.
- `03-outbound.json`: session check, prioritas manual/AI, pengirim teks/video, preflight database terbaru, receipt, UNKNOWN tanpa blind retry.
- `04-followup.json`: dispatch terbatas dan pemulihan lease.

Pilihan satu canvas: `../release/Kendaliku_MyControl_v3_All_In_One.json`. Jangan aktifkan kedua versi atau webhook lama bersamaan. Semua ekspor nonaktif; credentials tidak disertakan. Workflow asli `../mycontrol.json` dipertahankan sebagai arsip, bukan untuk diaktifkan bersamaan.

Panduan lengkap konfigurasi, pengamanan, pengecualian kontak, batas throughput, langkah pemasangan dan uji penerimaan: [README_MULAI.md](../release/README_MULAI.md).

Database project: `vpneonfehqfsxclqcman`. Membutuhkan migrasi sampai `008_contact_exclusions.sql`. Kontrol operasional ada di My Control; credentials tetap server-side di n8n/Vercel. Koneksi web belum dapat dinyatakan aktif sampai service-role key yang valid tersedia dan `/api/health` membuktikan koneksi.

`npm test` memverifikasi kontrak antrean, pengecualian, preflight, graf/referensi node dan proteksi aplikasi. Uji lokal tidak menggantikan uji impor/runtime n8n dan pengiriman nyata melalui WAHA.
