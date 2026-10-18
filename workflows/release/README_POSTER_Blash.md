# My Control Blash — Aktivasi Poster via WAHA sendImage

Perubahan versi 18 Oktober 2026: Blash mendukung poster JPEG/PNG/WebP (maks. 8 MB) dan video MP4. Media masuk ke bucket privat `mycontrol-campaigns`, lalu n8n memperoleh signed URL sementara dari Supabase sebelum mengirim.

## PENTING — GitHub/Vercel tidak otomatis mengubah n8n yang berjalan

1. Di My Control > Blash > detail draft, unduh workflow sesuai arsitektur n8n saat ini.
   - **All-in-one (WAHA Trigger)**: `/api/campaigns/workflow?kind=all`.
   - **Empat modul**: hanya modul outbound `/api/campaigns/workflow`.
2. Simpan cadangan workflow aktif di n8n. Matikan workflow pengirim lama **sebelum** mengaktifkan pengirim baru. Jika memakai all-in-one, jangan aktifkan all-in-one lama bersamaan dengan workflow baru.
3. Import JSON yang sesuai dan verifikasi ulang credential/variable `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `WAHA_BASE_URL`, `WAHA_API_KEY`, `WAHA_SESSION` sesuai konfigurasi yang telah berjalan. Tidak ada secret dalam file JSON.
4. Dalam workflow baru, node **Campaign Worker Heartbeat** harus memanggil `mc_campaign_heartbeat_v2` dengan `p_image:true` sesudah session WAHA berstatus WORKING. Node **WAHA Send Text** memilih `/api/sendImage` saat URL berakhiran `.jpg`, `.jpeg`, `.png`, atau `.webp`; video tetap `/api/sendVideo`, teks `/api/sendText`.
5. Saat aktif, indikator `Pengirim gambar` di detail Blash harus berubah menjadi siap. Jangan secara manual mengubah flag `image_supported` di database: flag itu hanya bukti heartbeat worker baru.
6. Buat Blash poster baru dengan **hanya nomor uji milik sendiri** dan izin yang sah. Unggah gambar dari HP. Simpan draft, kirim uji ke nomor sendiri, tunggu status Diterima gateway, periksa gambar/caption di WhatsApp yang sebenarnya. Pengiriman massal tetap memerlukan izin promosi penerima.
7. Periksa n8n Executions untuk node WAHA, `mc_mark_outbound_sent` dan receipt. Pada timeout/hasil ambigu, job masuk UNKNOWN dan tidak otomatis dikirim ulang untuk menghindari duplikasi.

**Link berbagi Google Drive bukan URL gambar langsung.** Google Drive sering mengembalikan HTML/login/redirect yang tidak dapat digunakan `sendImage`. Unduh poster dahulu lalu unggah dari HP ke My Control. Alternatifnya gunakan URL HTTPS publik langsung yang berakhiran ekstensi gambar yang didukung.

Jika status `image_supported=false` sesudah impor, periksa apakah workflow baru aktif, session WAHA berstatus WORKING, dan apakah n8n menjalankan heartbeat v2. Jangan bypass guard pengiriman.
