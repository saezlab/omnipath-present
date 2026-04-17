import type React from "react"
import { Suspense } from "react"
import type { Metadata } from "next"
import { Inter } from "next/font/google"
import { ThemeProvider } from "next-themes"
import { NuqsAdapter } from "nuqs/adapters/next/app"
import { SidebarContentProvider } from "@/contexts/sidebar-content-context"

import { SidebarProvider } from "@/components/ui/sidebar"
import { Providers } from "@/components/providers"
import { AppSidebar } from "@/components/layout/app-sidebar"

import "./globals.css"

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "OmniPath Explorer",
  description: "Explore molecular interactions, pathways, and biological annotations",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.className} flex min-h-screen flex-col overflow-hidden bg-background`}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <Providers>
            <NuqsAdapter>
              <SidebarContentProvider>
                <SidebarProvider defaultOpen>
                    <AppSidebar />
                    <main className="flex min-h-0 flex-1 w-full overflow-hidden">
                      {children}
                    </main>
                  </SidebarProvider>
              </SidebarContentProvider>
            </NuqsAdapter>
          </Providers>
        </ThemeProvider>
      </body>
    </html>
  )
}
