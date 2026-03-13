"use client"

import { useState, useCallback } from "react"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { ChatPanel } from "./chat-panel"
import { ResultsPanel } from "./results-panel"
import { ChatMessage } from "../types"

export interface ToolResult {
  id: string
  toolName: "searchEntities" | "resolveEntityIdentifiers" | "searchOntologyTerms" | "resolveOntologyTerms" | "exploreOntologyTree" | "searchInteractions"
  query: Record<string, unknown>
  results: Array<Record<string, unknown>>
  timestamp: Date
  messageId: string
}

export interface DualModeInterfaceProps {
  messages: ChatMessage[]
  input: string
  handleInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  handleSubmit: (e?: React.FormEvent<HTMLFormElement>) => void
  isLoading: boolean
  append: (message: ChatMessage) => void
  reload: () => void
  stop: () => void
  setMessages: (messages: ChatMessage[]) => void
}

export function DualModeInterface({
  messages,
  input,
  handleInputChange,
  handleSubmit,
  isLoading,
  append,
  reload,
  stop,
  setMessages,
}: DualModeInterfaceProps) {
  const [mode, setMode] = useState<"chat" | "results">("chat")
  const [selectedToolResult, setSelectedToolResult] = useState<ToolResult | null>(null)

  const handleToolResultClick = useCallback((result: ToolResult) => {
    setSelectedToolResult(result)
    setMode("results")
  }, [])

  const handleBackToChat = useCallback(() => {
    setMode("chat")
    // Keep selectedToolResult for quick return if needed
  }, [])

  return (
    <div className="h-full bg-background overflow-hidden">
      {mode === "chat" ? (
        // Chat mode - full screen
        <ChatPanel
          messages={messages}
          input={input}
          handleInputChange={handleInputChange}
          handleSubmit={handleSubmit}
          isLoading={isLoading}
          append={append}
          reload={reload}
          stop={stop}
          setMessages={setMessages}
          onToolResultClick={handleToolResultClick}
          mode={mode}
          onMaximize={handleBackToChat}
        />
      ) : (
        // Results mode - split view
        <ResizablePanelGroup
          direction="horizontal"
          className="h-full"
        >
          <ResizablePanel
            defaultSize={33}
            minSize={20}
            maxSize={50}
          >
            <ChatPanel
              messages={messages}
              input={input}
              handleInputChange={handleInputChange}
              handleSubmit={handleSubmit}
              isLoading={isLoading}
              append={append}
              reload={reload}
              stop={stop}
              setMessages={setMessages}
              onToolResultClick={handleToolResultClick}
              mode={mode}
              onMaximize={handleBackToChat}
            />
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel
            defaultSize={67}
            minSize={50}
            maxSize={80}
          >
            <ResultsPanel
              toolResult={selectedToolResult}
              onClose={handleBackToChat}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
    </div>
  )
}
