"use client"

import type { ReactNode } from "react"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { useChatLayout } from "@/contexts/chat-layout-context"
import { ChatPane } from "@/features/workspace/chat-pane"

export function GlobalChatLayout({ children }: { children: ReactNode }) {
  const { isChatOpen } = useChatLayout()

  if (!isChatOpen) {
    return <div className="flex h-full w-full">{children}</div>
  }

  return (
    <ResizablePanelGroup direction="horizontal" className="h-full w-full">
      <ResizablePanel defaultSize={70} minSize={30} className="flex min-h-0 flex-col relative">
        {children}
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={30} minSize={20} className="flex min-h-0 flex-col relative border-l">
        <ChatPane />
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
