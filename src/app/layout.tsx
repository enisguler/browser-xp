import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Browser XP",
  description:
    "A Next.js front-end that boots a local Windows XP disk in the browser with 2 MB on-demand chunks.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
