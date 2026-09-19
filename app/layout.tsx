import "./globals.css"; import Shell from "@/components/Shell";
export const metadata={title:"My Control — Bantu Beres",description:"Sales & CS Control Center Bantu Beres"};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="id"><body><Shell>{children}</Shell></body></html>}
