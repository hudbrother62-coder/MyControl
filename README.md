# My Control — Bantu Beres Sales Control Center

Control plane untuk CS, penjualan, payment verification, produk, laporan, dan automation Bantu Beres.

## Status fase 1
- Dashboard: siap
- Inbox UI: siap
- Sales Pipeline: siap
- Orders: siap
- Payment Verification: siap
- Products: siap
- Reports: siap
- Automation Settings: siap
- Integrations: siap
- Dark/Light mode: siap
- Mobile responsive: siap
- Google Sheets master: sudah dibuat
- Supabase: tahap berikutnya
- n8n: tahap berikutnya
- WAHA: menunggu service tersedia

## Jalankan lokal
```bash
npm install
npm run dev
```

## Deploy
Framework: Next.js
Build command: `npm run build`
Output: Next.js default
Node: 20+

## Security
Jangan simpan token Telegram, WAHA API key, Supabase service-role key, atau credential pembayaran di repository/frontend. Semua secret harus berada di environment variables / credential store.
