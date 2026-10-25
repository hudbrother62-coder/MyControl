"use client";

import { useEffect } from "react";

// A root-layout failure must not leave mobile users on Next.js's black crash screen.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[My Control] Root rendering error", error);
  }, [error]);

  return (
    <html lang="id">
      <body style={{ margin: 0, background: "#09090e", color: "#f4f4f5", fontFamily: "system-ui, sans-serif" }}>
        <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, boxSizing: "border-box" }}>
          <section role="alert" style={{ width: "100%", maxWidth: 440, padding: 24, borderRadius: 16, border: "1px solid #35353d", background: "#16161e", boxSizing: "border-box" }}>
            <p style={{ color: "#fb7185", fontSize: 13, fontWeight: 700, letterSpacing: "0.08em" }}>MY CONTROL</p>
            <h1 style={{ fontSize: 24, lineHeight: 1.25, margin: "12px 0" }}>Halaman mengalami gangguan</h1>
            <p style={{ fontSize: 15, lineHeight: 1.6, color: "#d4d4d8" }}>
              Aplikasi belum berhasil ditampilkan. Coba lagi atau muat ulang untuk mengambil versi website terbaru.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 20 }}>
              <button type="button" onClick={() => reset()} style={{ border: 0, borderRadius: 10, background: "#ef4444", color: "#fff", padding: "12px 16px", fontWeight: 700, cursor: "pointer" }}>Coba lagi</button>
              <button type="button" onClick={() => window.location.reload()} style={{ border: "1px solid #52525b", borderRadius: 10, background: "transparent", color: "#fff", padding: "12px 16px", fontWeight: 700, cursor: "pointer" }}>Muat ulang penuh</button>
            </div>
            <p style={{ color: "#a1a1aa", fontSize: 12, lineHeight: 1.6, marginTop: 20 }}>
              Jika masih gagal pada HP, buka situs melalui tab samaran untuk memeriksa kemungkinan cache browser yang bermasalah.
            </p>
          </section>
        </main>
      </body>
    </html>
  );
}
