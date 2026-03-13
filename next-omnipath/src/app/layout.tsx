import type React from "react"
import type { Metadata } from "next"
import { Inter } from "next/font/google"
import { ThemeProvider } from "next-themes"
import { NuqsAdapter } from "nuqs/adapters/next/app"
import { SidebarProvider } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/layout/app-sidebar"
import { SidebarContentProvider } from "@/contexts/sidebar-content-context"
import { Providers } from "@/components/providers"
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
      <body className={inter.className}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <Providers>
            <NuqsAdapter>
              <SidebarContentProvider>
                <SidebarProvider>
                  <AppSidebar />
                  <main className="flex-1 w-full">
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
