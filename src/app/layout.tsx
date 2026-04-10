import type { Metadata, Viewport } from "next";
import "./globals.css";

import { ServiceWorkerRegister } from "@/components/service-worker-register";

export const metadata: Metadata = {
  title: "Sakha",
  description:
    "Sakha is a personal AI operator with modular providers, shared memory, tasks, and guarded local tools.",
  applicationName: "Sakha",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Sakha",
  },
};

export const viewport: Viewport = {
  themeColor: "#d6ff57",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}
