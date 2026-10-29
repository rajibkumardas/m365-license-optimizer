import type { Metadata } from "next";
import { headers } from "next/headers";
import { Suspense } from "react";
import { MobileNav, Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { config } from "@/lib/config";
import { listTenants } from "@/lib/data/service";
import "./globals.css";

export const metadata: Metadata = {
  title: "M365 License Optimizer",
  description: "Monitor, analyze and optimize Microsoft 365 license spend across tenants",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Azure App Service Authentication ("Easy Auth") injects the signed-in user here.
  const h = await headers();
  const userName = h.get("x-ms-client-principal-name");
  let tenants: { id: string; name: string }[] = [];
  try {
    tenants = listTenants();
  } catch {
    tenants = [];
  }

  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <ThemeProvider>
          <div className="flex min-h-screen">
            <Suspense>
              <Sidebar />
            </Suspense>
            <div className="flex min-w-0 flex-1 flex-col">
              <Suspense>
                <Topbar tenants={tenants} dataMode={config.dataMode} userName={userName} />
                <MobileNav />
              </Suspense>
              <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 md:px-8">{children}</main>
            </div>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
