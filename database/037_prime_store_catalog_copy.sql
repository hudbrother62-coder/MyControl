-- Correct product copy using bounded owner-playbook catalog sections 6–10.
-- No access URLs, promotions, automation settings or customer memory are changed.
begin;
create temporary table prime_catalog_before on commit drop as select source_key,payload from public.mc_runtime_knowledge where kind='PRODUCT' and source_key in ('PS_KASIR','PS_TV','PS_FILM','PS_SPORT','PS_DUNOKIDS');
update public.products set full_description='- Harga normal: Rp94.000.
- Jenis: aplikasi kasir untuk perangkat Android.
- Cocok untuk warung, toko kelontong, kios, usaha makanan dan minuman, angkringan, coffee shop, booth, serta UMKM.

Fitur dan manfaat yang diketahui:

- Mencatat transaksi penjualan.
- Menghitung total belanja dan kembalian otomatis.
- Mencatat produk dan harga.
- Melihat omzet hari ini dan riwayat transaksi.
- Mendukung transaksi tunai dan non-tunai.
- Dapat digunakan secara offline untuk fungsi kasir yang didukung.
- Mendukung printer struk thermal Bluetooth ESC/POS yang kompatibel, termasuk ukuran 58 mm dan 80 mm.
- Nama toko dapat disesuaikan.

Ketentuan:

- Tidak membutuhkan langganan bulanan untuk paket sekali bayar yang ditawarkan.
- Jangan menjanjikan fitur yang belum dikonfirmasi, seperti sinkronisasi cloud, pencadangan otomatis, atau fitur khusus lainnya.
- Jangan menjamin semua printer kompatibel. Kompatibilitas bergantung pada tipe dan protokol printer.', benefits='- Harga normal: Rp94.000.
- Jenis: aplikasi kasir untuk perangkat Android.
- Cocok untuk warung, toko kelontong, kios, usaha makanan dan minuman, angkringan, coffee shop, booth, serta UMKM.

Fitur dan manfaat yang diketahui:

- Mencatat transaksi penjualan.
- Menghitung total belanja dan kembalian otomatis.
- Mencatat produk dan harga.
- Melihat omzet hari ini dan riwayat transaksi.
- Mendukung transaksi tunai dan non-tunai.
- Dapat digunakan secara offline untuk fungsi kasir yang didukung.
- Mendukung printer struk thermal Bluetooth ESC/POS yang kompatibel, termasuk ukuran 58 mm dan 80 mm.
- Nama toko dapat disesuaikan.

Ketentuan:

- Tidak membutuhkan langganan bulanan untuk paket sekali bayar yang ditawarkan.
- Jangan menjanjikan fitur yang belum dikonfirmasi, seperti sinkronisasi cloud, pencadangan otomatis, atau fitur khusus lainnya.
- Jangan menjamin semua printer kompatibel. Kompatibilitas bergantung pada tipe dan protokol printer.', updated_at=now() where id='PS_KASIR' and source='OWNER_PRIME_STORE';
update public.mc_runtime_knowledge set payload=(select b.payload from prime_catalog_before b where b.source_key=mc_runtime_knowledge.source_key)||'{"promo_price": null, "description": "- Harga normal: Rp94.000.\n- Jenis: aplikasi kasir untuk perangkat Android.\n- Cocok untuk warung, toko kelontong, kios, usaha makanan dan minuman, angkringan, coffee shop, booth, serta UMKM.\n\nFitur dan manfaat yang diketahui:\n\n- Mencatat transaksi penjualan.\n- Menghitung total belanja dan kembalian otomatis.\n- Mencatat produk dan harga.\n- Melihat omzet hari ini dan riwayat transaksi.\n- Mendukung transaksi tunai dan non-tunai.\n- Dapat digunakan secara offline untuk fungsi kasir yang didukung.\n- Mendukung printer struk thermal Bluetooth ESC/POS yang kompatibel, termasuk ukuran 58 mm dan 80 mm.\n- Nama toko dapat disesuaikan.\n\nKetentuan:\n\n- Tidak membutuhkan langganan bulanan untuk paket sekali bayar yang ditawarkan.\n- Jangan menjanjikan fitur yang belum dikonfirmasi, seperti sinkronisasi cloud, pencadangan otomatis, atau fitur khusus lainnya.\n- Jangan menjamin semua printer kompatibel. Kompatibilitas bergantung pada tipe dan protokol printer.", "full_description": "- Harga normal: Rp94.000.\n- Jenis: aplikasi kasir untuk perangkat Android.\n- Cocok untuk warung, toko kelontong, kios, usaha makanan dan minuman, angkringan, coffee shop, booth, serta UMKM.\n\nFitur dan manfaat yang diketahui:\n\n- Mencatat transaksi penjualan.\n- Menghitung total belanja dan kembalian otomatis.\n- Mencatat produk dan harga.\n- Melihat omzet hari ini dan riwayat transaksi.\n- Mendukung transaksi tunai dan non-tunai.\n- Dapat digunakan secara offline untuk fungsi kasir yang didukung.\n- Mendukung printer struk thermal Bluetooth ESC/POS yang kompatibel, termasuk ukuran 58 mm dan 80 mm.\n- Nama toko dapat disesuaikan.\n\nKetentuan:\n\n- Tidak membutuhkan langganan bulanan untuk paket sekali bayar yang ditawarkan.\n- Jangan menjanjikan fitur yang belum dikonfirmasi, seperti sinkronisasi cloud, pencadangan otomatis, atau fitur khusus lainnya.\n- Jangan menjamin semua printer kompatibel. Kompatibilitas bergantung pada tipe dan protokol printer."}'::jsonb,synced_at=now() where kind='PRODUCT' and source_key='PS_KASIR';
update public.products set full_description='- Harga normal: Rp79.000.
- Fungsi: menonton berbagai channel televisi melalui perangkat Android yang kompatibel.

Manfaat dan fitur:

- Pilihan channel lokal dan internasional.
- Kategori hiburan, berita, anak-anak, film, dan olahraga sesuai ketersediaan.
- Menu Event untuk acara tertentu jika sumber tayangan tersedia.
- Tidak membutuhkan login untuk penggunaan sesuai versi yang ditawarkan.
- Mendukung perangkat Android yang kompatibel, termasuk HP Android, Android TV, Google TV, dan sebagian Android TV Box.
- Laptop/PC dapat digunakan melalui emulator Android yang kompatibel.
- Tidak dapat dipasang langsung sebagai APK Android di iPhone/iPad.

Ketentuan:

- Paket sekali bayar yang ditawarkan tidak memerlukan langganan bulanan atau tahunan.
- Kualitas gambar, kestabilan, dan ketersediaan channel bergantung pada sumber siaran dan koneksi internet.
- Jangan menjanjikan semua channel selalu aktif, semua acara pasti tersedia, atau semua siaran selalu HD.', benefits='- Harga normal: Rp79.000.
- Fungsi: menonton berbagai channel televisi melalui perangkat Android yang kompatibel.

Manfaat dan fitur:

- Pilihan channel lokal dan internasional.
- Kategori hiburan, berita, anak-anak, film, dan olahraga sesuai ketersediaan.
- Menu Event untuk acara tertentu jika sumber tayangan tersedia.
- Tidak membutuhkan login untuk penggunaan sesuai versi yang ditawarkan.
- Mendukung perangkat Android yang kompatibel, termasuk HP Android, Android TV, Google TV, dan sebagian Android TV Box.
- Laptop/PC dapat digunakan melalui emulator Android yang kompatibel.
- Tidak dapat dipasang langsung sebagai APK Android di iPhone/iPad.

Ketentuan:

- Paket sekali bayar yang ditawarkan tidak memerlukan langganan bulanan atau tahunan.
- Kualitas gambar, kestabilan, dan ketersediaan channel bergantung pada sumber siaran dan koneksi internet.
- Jangan menjanjikan semua channel selalu aktif, semua acara pasti tersedia, atau semua siaran selalu HD.', updated_at=now() where id='PS_TV' and source='OWNER_PRIME_STORE';
update public.mc_runtime_knowledge set payload=(select b.payload from prime_catalog_before b where b.source_key=mc_runtime_knowledge.source_key)||'{"promo_price": null, "description": "- Harga normal: Rp79.000.\n- Fungsi: menonton berbagai channel televisi melalui perangkat Android yang kompatibel.\n\nManfaat dan fitur:\n\n- Pilihan channel lokal dan internasional.\n- Kategori hiburan, berita, anak-anak, film, dan olahraga sesuai ketersediaan.\n- Menu Event untuk acara tertentu jika sumber tayangan tersedia.\n- Tidak membutuhkan login untuk penggunaan sesuai versi yang ditawarkan.\n- Mendukung perangkat Android yang kompatibel, termasuk HP Android, Android TV, Google TV, dan sebagian Android TV Box.\n- Laptop/PC dapat digunakan melalui emulator Android yang kompatibel.\n- Tidak dapat dipasang langsung sebagai APK Android di iPhone/iPad.\n\nKetentuan:\n\n- Paket sekali bayar yang ditawarkan tidak memerlukan langganan bulanan atau tahunan.\n- Kualitas gambar, kestabilan, dan ketersediaan channel bergantung pada sumber siaran dan koneksi internet.\n- Jangan menjanjikan semua channel selalu aktif, semua acara pasti tersedia, atau semua siaran selalu HD.", "full_description": "- Harga normal: Rp79.000.\n- Fungsi: menonton berbagai channel televisi melalui perangkat Android yang kompatibel.\n\nManfaat dan fitur:\n\n- Pilihan channel lokal dan internasional.\n- Kategori hiburan, berita, anak-anak, film, dan olahraga sesuai ketersediaan.\n- Menu Event untuk acara tertentu jika sumber tayangan tersedia.\n- Tidak membutuhkan login untuk penggunaan sesuai versi yang ditawarkan.\n- Mendukung perangkat Android yang kompatibel, termasuk HP Android, Android TV, Google TV, dan sebagian Android TV Box.\n- Laptop/PC dapat digunakan melalui emulator Android yang kompatibel.\n- Tidak dapat dipasang langsung sebagai APK Android di iPhone/iPad.\n\nKetentuan:\n\n- Paket sekali bayar yang ditawarkan tidak memerlukan langganan bulanan atau tahunan.\n- Kualitas gambar, kestabilan, dan ketersediaan channel bergantung pada sumber siaran dan koneksi internet.\n- Jangan menjanjikan semua channel selalu aktif, semua acara pasti tersedia, atau semua siaran selalu HD."}'::jsonb,synced_at=now() where kind='PRODUCT' and source_key='PS_TV';
update public.products set full_description='- Harga normal: Rp79.000.
- Nama untuk pelanggan: Film & Drakor atau HiTV Premium, sesuai konteks percakapan.

Manfaat dan fitur:

- Pilihan film, drama Korea, drama China, drama Asia, serial, dan anime.
- Subtitle Indonesia tersedia pada konten yang mendukungnya.
- Kualitas tayangan dapat mencapai HD atau 1080p, bergantung pada konten dan sumber.
- Paket yang ditawarkan memiliki pengalaman menonton tanpa iklan sesuai ketentuan paket.
- Ditujukan untuk perangkat Android yang kompatibel.
- PC/laptop dapat digunakan melalui emulator Android.
- Tidak dapat dipasang langsung sebagai APK Android di iPhone/iPad.
- Paket sekali bayar yang ditawarkan tidak memerlukan langganan bulanan.

Ketentuan:

- Jangan menjanjikan semua judul selalu tersedia.
- Jangan menjanjikan semua tayangan pasti HD atau memiliki subtitle Indonesia.
- Jangan menjanjikan seluruh film selalu bisa diputar.
- Jangan menjanjikan ketersediaan film Indonesia secara khusus tanpa informasi resmi.', benefits='- Harga normal: Rp79.000.
- Nama untuk pelanggan: Film & Drakor atau HiTV Premium, sesuai konteks percakapan.

Manfaat dan fitur:

- Pilihan film, drama Korea, drama China, drama Asia, serial, dan anime.
- Subtitle Indonesia tersedia pada konten yang mendukungnya.
- Kualitas tayangan dapat mencapai HD atau 1080p, bergantung pada konten dan sumber.
- Paket yang ditawarkan memiliki pengalaman menonton tanpa iklan sesuai ketentuan paket.
- Ditujukan untuk perangkat Android yang kompatibel.
- PC/laptop dapat digunakan melalui emulator Android.
- Tidak dapat dipasang langsung sebagai APK Android di iPhone/iPad.
- Paket sekali bayar yang ditawarkan tidak memerlukan langganan bulanan.

Ketentuan:

- Jangan menjanjikan semua judul selalu tersedia.
- Jangan menjanjikan semua tayangan pasti HD atau memiliki subtitle Indonesia.
- Jangan menjanjikan seluruh film selalu bisa diputar.
- Jangan menjanjikan ketersediaan film Indonesia secara khusus tanpa informasi resmi.', updated_at=now() where id='PS_FILM' and source='OWNER_PRIME_STORE';
update public.mc_runtime_knowledge set payload=(select b.payload from prime_catalog_before b where b.source_key=mc_runtime_knowledge.source_key)||'{"promo_price": null, "description": "- Harga normal: Rp79.000.\n- Nama untuk pelanggan: Film & Drakor atau HiTV Premium, sesuai konteks percakapan.\n\nManfaat dan fitur:\n\n- Pilihan film, drama Korea, drama China, drama Asia, serial, dan anime.\n- Subtitle Indonesia tersedia pada konten yang mendukungnya.\n- Kualitas tayangan dapat mencapai HD atau 1080p, bergantung pada konten dan sumber.\n- Paket yang ditawarkan memiliki pengalaman menonton tanpa iklan sesuai ketentuan paket.\n- Ditujukan untuk perangkat Android yang kompatibel.\n- PC/laptop dapat digunakan melalui emulator Android.\n- Tidak dapat dipasang langsung sebagai APK Android di iPhone/iPad.\n- Paket sekali bayar yang ditawarkan tidak memerlukan langganan bulanan.\n\nKetentuan:\n\n- Jangan menjanjikan semua judul selalu tersedia.\n- Jangan menjanjikan semua tayangan pasti HD atau memiliki subtitle Indonesia.\n- Jangan menjanjikan seluruh film selalu bisa diputar.\n- Jangan menjanjikan ketersediaan film Indonesia secara khusus tanpa informasi resmi.", "full_description": "- Harga normal: Rp79.000.\n- Nama untuk pelanggan: Film & Drakor atau HiTV Premium, sesuai konteks percakapan.\n\nManfaat dan fitur:\n\n- Pilihan film, drama Korea, drama China, drama Asia, serial, dan anime.\n- Subtitle Indonesia tersedia pada konten yang mendukungnya.\n- Kualitas tayangan dapat mencapai HD atau 1080p, bergantung pada konten dan sumber.\n- Paket yang ditawarkan memiliki pengalaman menonton tanpa iklan sesuai ketentuan paket.\n- Ditujukan untuk perangkat Android yang kompatibel.\n- PC/laptop dapat digunakan melalui emulator Android.\n- Tidak dapat dipasang langsung sebagai APK Android di iPhone/iPad.\n- Paket sekali bayar yang ditawarkan tidak memerlukan langganan bulanan.\n\nKetentuan:\n\n- Jangan menjanjikan semua judul selalu tersedia.\n- Jangan menjanjikan semua tayangan pasti HD atau memiliki subtitle Indonesia.\n- Jangan menjanjikan seluruh film selalu bisa diputar.\n- Jangan menjanjikan ketersediaan film Indonesia secara khusus tanpa informasi resmi."}'::jsonb,synced_at=now() where kind='PRODUCT' and source_key='PS_FILM';
update public.products set full_description='- Harga normal: Rp79.000.
- Fungsi: membantu pelanggan menikmati pilihan tayangan olahraga melalui perangkat yang kompatibel.

Manfaat dan fitur:

- Pilihan tayangan olahraga sesuai ketersediaan.
- Jadwal pertandingan.
- Pertandingan yang akan datang.
- Hasil pertandingan.
- Statistik, lineup, dan head-to-head (H2H).
- Pilihan olahraga yang pernah ditawarkan mencakup sepak bola, liga internasional, Liga Indonesia, turnamen internasional, bola basket/NBA, MotoGP, tenis, dan bola voli.
- Mendukung perangkat Android yang kompatibel.
- PC/laptop dapat menggunakan emulator Android.

Ketentuan:

- Jadwal, jenis olahraga, dan tayangan mengikuti ketersediaan sumber.
- Jangan menjamin setiap pertandingan selalu tersedia atau bebas gangguan.
- Jangan menyamakan fitur jadwal/statistik dengan jaminan siaran langsung tersedia.
- Untuk iPhone/iPad, jangan menjanjikan pemasangan APK Android. Akses melalui browser hanya boleh direkomendasikan sesuai kompatibilitas situs yang tersedia.', benefits='- Harga normal: Rp79.000.
- Fungsi: membantu pelanggan menikmati pilihan tayangan olahraga melalui perangkat yang kompatibel.

Manfaat dan fitur:

- Pilihan tayangan olahraga sesuai ketersediaan.
- Jadwal pertandingan.
- Pertandingan yang akan datang.
- Hasil pertandingan.
- Statistik, lineup, dan head-to-head (H2H).
- Pilihan olahraga yang pernah ditawarkan mencakup sepak bola, liga internasional, Liga Indonesia, turnamen internasional, bola basket/NBA, MotoGP, tenis, dan bola voli.
- Mendukung perangkat Android yang kompatibel.
- PC/laptop dapat menggunakan emulator Android.

Ketentuan:

- Jadwal, jenis olahraga, dan tayangan mengikuti ketersediaan sumber.
- Jangan menjamin setiap pertandingan selalu tersedia atau bebas gangguan.
- Jangan menyamakan fitur jadwal/statistik dengan jaminan siaran langsung tersedia.
- Untuk iPhone/iPad, jangan menjanjikan pemasangan APK Android. Akses melalui browser hanya boleh direkomendasikan sesuai kompatibilitas situs yang tersedia.', updated_at=now() where id='PS_SPORT' and source='OWNER_PRIME_STORE';
update public.mc_runtime_knowledge set payload=(select b.payload from prime_catalog_before b where b.source_key=mc_runtime_knowledge.source_key)||'{"promo_price": null, "description": "- Harga normal: Rp79.000.\n- Fungsi: membantu pelanggan menikmati pilihan tayangan olahraga melalui perangkat yang kompatibel.\n\nManfaat dan fitur:\n\n- Pilihan tayangan olahraga sesuai ketersediaan.\n- Jadwal pertandingan.\n- Pertandingan yang akan datang.\n- Hasil pertandingan.\n- Statistik, lineup, dan head-to-head (H2H).\n- Pilihan olahraga yang pernah ditawarkan mencakup sepak bola, liga internasional, Liga Indonesia, turnamen internasional, bola basket/NBA, MotoGP, tenis, dan bola voli.\n- Mendukung perangkat Android yang kompatibel.\n- PC/laptop dapat menggunakan emulator Android.\n\nKetentuan:\n\n- Jadwal, jenis olahraga, dan tayangan mengikuti ketersediaan sumber.\n- Jangan menjamin setiap pertandingan selalu tersedia atau bebas gangguan.\n- Jangan menyamakan fitur jadwal/statistik dengan jaminan siaran langsung tersedia.\n- Untuk iPhone/iPad, jangan menjanjikan pemasangan APK Android. Akses melalui browser hanya boleh direkomendasikan sesuai kompatibilitas situs yang tersedia.", "full_description": "- Harga normal: Rp79.000.\n- Fungsi: membantu pelanggan menikmati pilihan tayangan olahraga melalui perangkat yang kompatibel.\n\nManfaat dan fitur:\n\n- Pilihan tayangan olahraga sesuai ketersediaan.\n- Jadwal pertandingan.\n- Pertandingan yang akan datang.\n- Hasil pertandingan.\n- Statistik, lineup, dan head-to-head (H2H).\n- Pilihan olahraga yang pernah ditawarkan mencakup sepak bola, liga internasional, Liga Indonesia, turnamen internasional, bola basket/NBA, MotoGP, tenis, dan bola voli.\n- Mendukung perangkat Android yang kompatibel.\n- PC/laptop dapat menggunakan emulator Android.\n\nKetentuan:\n\n- Jadwal, jenis olahraga, dan tayangan mengikuti ketersediaan sumber.\n- Jangan menjamin setiap pertandingan selalu tersedia atau bebas gangguan.\n- Jangan menyamakan fitur jadwal/statistik dengan jaminan siaran langsung tersedia.\n- Untuk iPhone/iPad, jangan menjanjikan pemasangan APK Android. Akses melalui browser hanya boleh direkomendasikan sesuai kompatibilitas situs yang tersedia."}'::jsonb,synced_at=now() where kind='PRODUCT' and source_key='PS_SPORT';
update public.products set full_description='- Harga normal: Rp159.000.
- Fungsi: membantu orang tua mengelola penggunaan perangkat anak.

Fitur yang diketahui:

- Kontrol orang tua.
- Pengaturan waktu layar.
- Pembatasan penggunaan aplikasi.
- Penguncian aplikasi.
- Kontrol layar jarak jauh sesuai dukungan versi yang dijual.

Ketentuan:

- Jelaskan sebagai alat bantu orang tua, bukan jaminan mutlak bahwa anak selalu aman di internet.
- Jangan menjanjikan fitur pemantauan atau kontrol yang belum dipastikan.
- Tautan APK dan grup member belum tersedia dalam referensi ini. Jangan mengarang tautan atau mengirim tautan produk lain sebagai pengganti.', benefits='- Harga normal: Rp159.000.
- Fungsi: membantu orang tua mengelola penggunaan perangkat anak.

Fitur yang diketahui:

- Kontrol orang tua.
- Pengaturan waktu layar.
- Pembatasan penggunaan aplikasi.
- Penguncian aplikasi.
- Kontrol layar jarak jauh sesuai dukungan versi yang dijual.

Ketentuan:

- Jelaskan sebagai alat bantu orang tua, bukan jaminan mutlak bahwa anak selalu aman di internet.
- Jangan menjanjikan fitur pemantauan atau kontrol yang belum dipastikan.
- Tautan APK dan grup member belum tersedia dalam referensi ini. Jangan mengarang tautan atau mengirim tautan produk lain sebagai pengganti.', updated_at=now() where id='PS_DUNOKIDS' and source='OWNER_PRIME_STORE';
update public.mc_runtime_knowledge set payload=(select b.payload from prime_catalog_before b where b.source_key=mc_runtime_knowledge.source_key)||'{"promo_price": null, "description": "- Harga normal: Rp159.000.\n- Fungsi: membantu orang tua mengelola penggunaan perangkat anak.\n\nFitur yang diketahui:\n\n- Kontrol orang tua.\n- Pengaturan waktu layar.\n- Pembatasan penggunaan aplikasi.\n- Penguncian aplikasi.\n- Kontrol layar jarak jauh sesuai dukungan versi yang dijual.\n\nKetentuan:\n\n- Jelaskan sebagai alat bantu orang tua, bukan jaminan mutlak bahwa anak selalu aman di internet.\n- Jangan menjanjikan fitur pemantauan atau kontrol yang belum dipastikan.\n- Tautan APK dan grup member belum tersedia dalam referensi ini. Jangan mengarang tautan atau mengirim tautan produk lain sebagai pengganti.", "full_description": "- Harga normal: Rp159.000.\n- Fungsi: membantu orang tua mengelola penggunaan perangkat anak.\n\nFitur yang diketahui:\n\n- Kontrol orang tua.\n- Pengaturan waktu layar.\n- Pembatasan penggunaan aplikasi.\n- Penguncian aplikasi.\n- Kontrol layar jarak jauh sesuai dukungan versi yang dijual.\n\nKetentuan:\n\n- Jelaskan sebagai alat bantu orang tua, bukan jaminan mutlak bahwa anak selalu aman di internet.\n- Jangan menjanjikan fitur pemantauan atau kontrol yang belum dipastikan.\n- Tautan APK dan grup member belum tersedia dalam referensi ini. Jangan mengarang tautan atau mengirim tautan produk lain sebagai pengganti."}'::jsonb,synced_at=now() where kind='PRODUCT' and source_key='PS_DUNOKIDS';
commit;
