'use client';
import {useStore} from '@/components/Store';
export default function StorePagination(){const s=useStore();return <div className="actions section"><button className="btn" disabled={s.page===0||s.loading} onClick={()=>s.setPage(s.page-1)}>Sebelumnya</button><span>Halaman {s.page+1} · hingga 50 data per daftar</span><button className="btn" disabled={!s.hasMore||s.loading} onClick={()=>s.setPage(s.page+1)}>Berikutnya</button></div>}
