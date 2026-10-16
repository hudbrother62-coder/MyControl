"use client";
import Link from "next/link";
import {
  Bot,
  Package,
  ReceiptText,
  ShieldCheck,
  ChartNoAxesCombined,
  PlugZap,
  Settings,
  Users,
  KanbanSquare,
  Send,
} from "lucide-react";
import { useStore } from "@/components/Store";
const sections = [
  {
    title: "Bot & operasional",
    items: [
      {
        href: "/automation",
        label: "Kontrol bot & otomasi",
        description:
          "Atur model, instruksi, follow-up, integrasi, serta pantau versi konfigurasi worker.",
        Icon: Bot,
      },
      {
        href: "/integrations",
        label: "Integrasi",
        description: "Periksa koneksi WhatsApp, n8n, database, dan Telegram.",
        Icon: PlugZap,
      },
      {
        href: "/settings",
        label: "Pengaturan",
        description: "Kelola konfigurasi pusat kontrol.",
        Icon: Settings,
      },
    ],
  },
  {
    title: "Pelanggan & penjualan",
    items: [
      {
        href: "/contacts",
        label: "Kontak",
        description: "Import Excel/CSV, label, dan izin promosi.",
        Icon: Users,
      },
      {
        href: "/sales",
        label: "Sales — pipeline lama",
        description: "Akses seluruh lead dan alur penjualan sebelumnya.",
        Icon: KanbanSquare,
      },
      {
        href: "/crm",
        label: "CRM per produk",
        description: "Pantau peluang, catatan, dan pengingat follow-up.",
        Icon: KanbanSquare,
      },
      {
        href: "/campaigns",
        label: "Kampanye WhatsApp",
        description: "Susun promosi teks/video dan pantau penerima.",
        Icon: Send,
      },
    ],
  },
  {
    title: "Produk & transaksi",
    items: [
      {
        href: "/products",
        label: "Produk",
        description: "Kelola katalog dan informasi produk untuk bot.",
        Icon: Package,
      },
      {
        href: "/orders",
        label: "Pesanan",
        description: "Pantau pesanan dan proses pemenuhan.",
        Icon: ReceiptText,
      },
      {
        href: "/payments",
        label: "Pembayaran",
        description: "Tinjau bukti dan verifikasi pembayaran.",
        Icon: ShieldCheck,
      },
      {
        href: "/reports",
        label: "Laporan",
        description: "Lihat ringkasan hasil operasional dan penjualan.",
        Icon: ChartNoAxesCombined,
      },
    ],
  },
];
export default function Control() {
  const s = useStore();
  return (
    <>
      <div className="pageHead">
        <div>
          <h1>Pusat Kontrol</h1>
          <p>
            Semua fitur My Control, termasuk menu yang sudah ada sebelumnya.
          </p>
        </div>
        <Link className="btn primary" href="/automation">
          Buka kontrol bot
        </Link>
      </div>
      <div className="card controlStatus">
        <Bot size={24} />
        <div>
          <b>
            Bot WhatsApp:{" "}
            {s.loading
              ? "memuat…"
              : s.settings.botEnabled
                ? "diaktifkan"
                : "dinonaktifkan"}
          </b>
          <p className="muted">
            Status ini mengikuti pengaturan bot. Koneksi layanan diperiksa
            melalui Integrasi.
          </p>
        </div>
      </div>
      {sections.map((section) => (
        <section key={section.title} className="section">
          <h2>{section.title}</h2>
          <div className="controlGrid">
            {section.items.map(({ href, label, description, Icon }) => (
              <Link className="card controlTile" href={href} key={href}>
                <Icon size={24} />
                <div>
                  <h3>{label}</h3>
                  <p>{description}</p>
                </div>
                <span aria-hidden="true">›</span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
