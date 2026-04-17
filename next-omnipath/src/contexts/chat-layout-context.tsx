"use client"

import { createContext, useContext, useState, type ReactNode } from "react"

interface ChatLayoutContextProps {
  isChatOpen: boolean
  setChatOpen: (open: boolean) => void
  toggleChat: () => void
}

const ChatLayoutContext = createContext<ChatLayoutContextProps | undefined>(undefined)

export function ChatLayoutProvider({ children, defaultOpen = false }: { children: ReactNode, defaultOpen?: boolean }) {
  const [isChatOpen, setChatOpen] = useState(defaultOpen)

  const toggleChat = () => setChatOpen((prev) => !prev)

  return (
    <ChatLayoutContext.Provider value={{ isChatOpen, setChatOpen, toggleChat }}>
      {children}
    </ChatLayoutContext.Provider>
  )
}

export function useChatLayout() {
  const context = useContext(ChatLayoutContext)
  if (!context) {
    throw new Error("useChatLayout must be used within a ChatLayoutProvider")
  }
  return context
}
