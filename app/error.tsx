"use client";

import { useEffect } from "react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[My Control] Page rendering error", error);
  }, [error]);

  return (
    <section role="alert" style={{ maxWidth: 520, margin: "32px auto", padding: 24, borderRadius: 16, border: "1px solid #71717a", lineHeight: 1.6 }}>
      <h1 style={{ marginTop: 0, fontSize: 22 }}>Halaman belum bisa dimuat</h1>
      <p>Data dan menu lain tetap aman. Coba muat ulang bagian ini atau ambil versi terbaru dari website.</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        <button type="button" className="btn primary" onClick={() => reset()}>Coba lagi</button>
        <button type="button" className="btn" onClick={() => window.location.reload()}>Muat ulang penuh</button>
      </div>
    </section>
  );
}
