import {ArrowUpRight,Clock3,ShieldCheck,WalletCards} from "lucide-react";
const kpis=[["Penjualan Hari Ini","Rp 0","Belum ada transaksi"],["Closing","0","Hari ini"],["Pending","0","Perlu tindak lanjut"],["Laba Bersih","Rp 0","Hari ini"]];
export default function Page(){return <><div className="pageHead"><div><h1>Dashboard</h1><p>Ringkasan operasional penjualan dan CS Bantu Beres.</p></div><div className="actions"><button className="btn">Lihat laporan</button><button className="btn primary">Buat order</button></div></div>
<div className="grid4">{kpis.map(([a,b,c])=><div className="card" key={a}><div className="kpiLabel">{a}</div><div className="kpiValue">{b}</div><div className="kpiMeta">{c}</div></div>)}</div>
<div className="grid3 section">
<div className="card"><div className="sectionTitle"><h2>Payment queue</h2><ShieldCheck size={18}/></div><div className="empty"><strong>Belum ada verifikasi</strong>Bukti pembayaran customer akan masuk di sini.</div></div>
<div className="card"><div className="sectionTitle"><h2>Follow-up hari ini</h2><Clock3 size={18}/></div><div className="empty"><strong>0 follow-up</strong>n8n akan mengisi antrean berdasarkan aturan yang kamu buat.</div></div>
<div className="card"><div className="sectionTitle"><h2>Uang masuk</h2><WalletCards size={18}/></div><div className="empty"><strong>Belum ada payment event</strong>DANA, GoPay, dan bank akan ditampilkan setelah integrasi.</div></div>
</div>
<div className="section card"><div className="sectionTitle"><h2>Status sistem</h2><span className="badge warn">Setup</span></div><div className="tableWrap"><table className="table"><thead><tr><th>Komponen</th><th>Status</th><th>Fungsi</th></tr></thead><tbody>
<tr><td>Web Control Center</td><td><span className="badge ok">Ready</span></td><td>Dashboard & kontrol operasional</td></tr>
<tr><td>Google Sheets</td><td><span className="badge ok">Ready</span></td><td>Master produk, promo, FAQ</td></tr>
<tr><td>Supabase</td><td><span className="badge warn">Connect next</span></td><td>Database transaksi & chat</td></tr>
<tr><td>n8n</td><td><span className="badge warn">Connect next</span></td><td>Automation engine</td></tr>
<tr><td>WAHA</td><td><span className="badge warn">Not connected</span></td><td>WhatsApp gateway</td></tr>
</tbody></table></div></div></>}
