import type React from "react"
import { Suspense } from "react"
import type { Metadata } from "next"
import { Inter } from "next/font/google"
import { ThemeProvider } from "next-themes"
import { NuqsAdapter } from "nuqs/adapters/next/app"
import { SidebarContentProvider } from "@/contexts/sidebar-content-context"
import { FloatingNavProvider } from "@/contexts/floating-nav-context"
import { Providers } from "@/components/providers"
import { OmniPathFloatingMenu } from "@/components/layout/omnipath-floating-menu"
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
      <body className={`${inter.className} flex min-h-screen flex-col overflow-hidden`}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <Providers>
            <NuqsAdapter>
              <SidebarContentProvider>
                <FloatingNavProvider>
                  <Suspense fallback={null}>
                    <OmniPathFloatingMenu />
                  </Suspense>
                  <main className="flex min-h-0 flex-1 w-full overflow-hidden">
                    {children}
                  </main>
                </FloatingNavProvider>
              </SidebarContentProvider>
            </NuqsAdapter>
          </Providers>
        </ThemeProvider>
      </body>
    </html>
  )
}
