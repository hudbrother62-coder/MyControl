import Image from "next/image";

export default function Logo() {
  return <Image src="/icon.svg" alt="Logo My Control" width={32} height={32} unoptimized />;
}
