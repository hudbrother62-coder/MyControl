# Verifikasi rilis v3 — 16 Oktober 2026

- 67 tes aplikasi/database/workflow: lulus, 0 gagal.
- TypeScript dan build Next.js: lulus.
- Satu canvas: satu webhook inbound + tiga schedule trigger, seluruh koneksi/referensi lokal valid, ekspor nonaktif.
- Database 008: berhasil diterapkan ke project My Control. RLS tabel pengecualian aktif; anon tidak bisa mengubah kebijakan; belum ada nomor produksi dimasukkan otomatis.
- Peninjauan kode menangkap race saat pengecualian disimpan ketika AI sedang bekerja; completion-time gate dan follow-up insertion guard sudah ditambahkan, tes regresi lulus, tinjauan ulang tidak menemukan masalah Important tersisa.
- Teruji: promosi diblokir dengan CS/manual tetap tersedia; seluruh otomatisasi diblokir tanpa menghilangkan inbound; pengecualian setelah claim; pengecualian saat inference; pembatalan tidak dipulihkan setelah pengecualian dihapus; nomor LID tidak dianggap nomor telepon; daftar pemilihan tidak memasukkan kontak dikecualikan; izin promosi opt-out tidak direset.
- Pengiriman 1.000 penerima, urutan dua bagian, opt-out/takeover, delivery receipt monotonic, dedupe, job UNKNOWN dan otorisasi termasuk tes regresi antrean lokal.

Belum diuji pada runtime n8n/WAHA milik owner: impor di versi n8n terpasang, credentials Groq, konektivitas server, pairing session, dukungan video engine WAHA dan penerimaan pesan nyata. Tidak ada workflow diaktifkan atau promosi dikirim dari proses pembuatan paket ini. Web masih memerlukan service-role key valid sebelum fungsi database bisa dipakai dari web.
