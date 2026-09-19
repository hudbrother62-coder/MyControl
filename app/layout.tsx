import "./globals.css";
import Shell from "@/components/Shell";
import {StoreProvider} from "@/components/Store";

export const metadata={title:"My Control — Bantu Beres",description:"Sales & CS Control Center Bantu Beres"};

export default function RootLayout({children}:{children:React.ReactNode}){
  return <html lang="id"><body><StoreProvider><Shell>{children}</Shell></StoreProvider></body></html>
}
