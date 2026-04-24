"use client"

import { useEffect, useState } from "react"
import { Switch } from "@/components/ui/switch"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  SidebarRail,
} from "@/components/ui/sidebar"
import {
  Search,
  Sun,
  Moon,
  ListChecks,
  Database,
  ExternalLink,
  MessageSquare,
} from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useTheme } from "next-themes"
import Image from "next/image"
import { useSidebarContent } from "@/contexts/sidebar-content-context"

const navigationItems = [
  {
    title: "Explore",
    url: "/explore",
    icon: Search,
  },
  {
    title: "Selection",
    url: "/selection",
    icon: ListChecks,
  },
  {
    title: "Resources",
    url: "/resources",
    icon: Database,
  },
  {
    title: "API Docs",
    url: "/api/docs",
    icon: ExternalLink,
    external: true,
  }
]

export function AppSidebar() {
  const pathname = usePathname()
  const { setTheme, resolvedTheme } = useTheme()
  const { sidebarContent } = useSidebarContent()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const isPathActive = (url: string) => {
    return pathname === url || pathname.startsWith(`${url}/`)
  }

  return (
    <Sidebar>
      <SidebarHeader className="border-b">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/explore" className="flex items-center gap-2">
                <Image
                  src="/omnipath-logo-gradient.svg"
                  alt="OmniPath Logo"
                  width={40}
                  height={40}
                />
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-bold text-lg bg-gradient-to-r from-[#007B7F] via-[#6EA945] to-[#FCCC06] bg-clip-text text-transparent">
                    OmniPath
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup className="px-2">
          <SidebarGroupContent>
            <SidebarMenu>
              {navigationItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={isPathActive(item.url)}>
                    <Link
                      href={item.url}
                      target={item.external ? "_blank" : undefined}
                      rel={item.external ? "noopener noreferrer" : undefined}
                    >
                      <item.icon className="h-5 w-5" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              <SidebarMenuItem>
                <SidebarMenuButton disabled className="opacity-60">
                  <MessageSquare className="h-5 w-5" />
                  <span>AI Assistant</span>
                </SidebarMenuButton>
                <SidebarMenuBadge className="text-[10px]">Soon</SidebarMenuBadge>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {((pathname === '/selection' || pathname.startsWith('/explore') || pathname === '/resources') && sidebarContent) && (
          <>
            <div className="px-3">
              <SidebarSeparator />
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto pb-4 px-4">
              {sidebarContent}
            </div>
          </>
        )}
      </SidebarContent>

      <SidebarFooter className="border-t">
        <div className="flex items-center justify-center px-4 py-2">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <Sun className="h-3 w-3 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">Light</span>
            </div>
            {mounted ? (
              <Switch
                checked={resolvedTheme === "dark"}
                onCheckedChange={(checked) => {
                  if (checked) {
                    setTheme("dark")
                  } else {
                    setTheme("light")
                  }
                }}
                className="data-[state=checked]:bg-primary"
              />
            ) : (
              <div className="h-[1.15rem] w-8 rounded-full bg-input animate-pulse" />
            )}
            <div className="flex items-center gap-1">
              <span className="text-xs font-medium text-muted-foreground">Dark</span>
              <Moon className="h-3 w-3 text-muted-foreground" />
            </div>
          </div>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
