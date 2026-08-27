import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Resona PI widget 1.0",
  description:
    "Projektoberoende lägenhetsstatistik och areaöversikt för Resona AB, direkt från StreamBIM.",
  openGraph: {
    title: "Resona PI widget 1.0",
    description: "Modellen i siffror. Lägenheter, areor och StreamBIM.",
    images: ["https://jannelangharet.github.io/Resona-PI-widget-1.0/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Resona PI widget 1.0",
    description: "Modellen i siffror. Lägenheter, areor och StreamBIM.",
    images: ["https://jannelangharet.github.io/Resona-PI-widget-1.0/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="sv">
      <body>{children}</body>
    </html>
  );
}
