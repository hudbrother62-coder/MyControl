"use client";
import {useSummary} from "@/components/useSummary";
import { rupiah } from "@/components/Store";
export default function Reports() {
  const {data,error}=useSummary();
  const revenue=Number(data?.revenue||0),profit=Number(data?.profit||0);
  const conversion=data?.lead_total?Math.round(100*Number(data.lead_closing)/Number(data.lead_total)):0;
  const byProduct:Record<string,{qty:number;total:number}>=Object.fromEntries((data?.by_product||[]).map((p:any)=>[p.product,{qty:Number(p.qty),total:Number(p.total)}]));
  return (
    <>
      {error&&<div className="notice errorNotice">{error}</div>}
      <div className="pageHead">
        <div>
          <h1>Reports</h1>
          <p>Angka dihitung dari order yang sudah terverifikasi.</p>
        </div>
        <a className="btn primary" href="/api/reports/export">
          Export CSV
        </a>
      </div>
      <div className="grid4">
        <div className="card">
          <div className="kpiLabel">Revenue</div>
          <div className="kpiValue">{rupiah(revenue)}</div>
        </div>
        <div className="card">
          <div className="kpiLabel">Net Profit</div>
          <div className="kpiValue">{rupiah(profit)}</div>
        </div>
        <div className="card">
          <div className="kpiLabel">Conversion</div>
          <div className="kpiValue">{conversion}%</div>
        </div>
        <div className="card">
          <div className="kpiLabel">Closing</div>
          <div className="kpiValue">{data?.closing||0}</div>
        </div>
      </div>
      <div className="section card tableWrap">
        <div className="sectionTitle">
          <h2>Penjualan per produk · 50 terbesar</h2>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Produk</th>
              <th>Terjual</th>
              <th>Revenue</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(byProduct).map(([p, v]) => (
              <tr key={p}>
                <td>{p}</td>
                <td>{v.qty}</td>
                <td>{rupiah(v.total)}</td>
              </tr>
            ))}
            {!Object.keys(byProduct).length && (
              <tr>
                <td colSpan={3}>
                  <div className="empty">Belum ada closing.</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
