"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { Minimize2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChatPanel } from "@/features/chat/components/chat-panel";
import { chatMessagesToUIMessages, uiMessagesToChatMessages } from "@/features/chat/types";
import { FloatingChatLauncher } from "./floating-chat-launcher";
import { useFloatingChatState } from "./use-floating-chat-state";
import { buildUrlForToolResult } from "@/features/chat/tool-result-navigation";
import type { ToolResult } from "@/features/chat/components/dual-mode-interface";

const initialMessages: UIMessage[] = [
  {
    id: "floating-chat-welcome",
    role: "assistant",
    parts: [
      {
        type: "text",
        text: "Hi — I can help you search, inspect interactions, and open URL-backed views directly.",
      },
    ],
  },
];

export function FloatingChatWindow() {
  const router = useRouter();
  const { isOpen, isMinimized, open, close, minimize, restore } = useFloatingChatState();
  const [input, setInput] = useState("");

  const { messages, sendMessage, status, stop, setMessages, regenerate } = useChat<UIMessage>({
    id: "floating-chat",
    messages: initialMessages,
    transport: new DefaultChatTransport({ api: "/app-api/chat" }),
  });

  const chatMessages = useMemo(() => uiMessagesToChatMessages(messages), [messages]);
  const isLoading = status === "submitted" || status === "streaming";

  const handleSubmit = (event?: React.FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    const value = input.trim();
    if (!value) return;

    sendMessage({
      role: "user",
      parts: [{ type: "text", text: value }],
    });
    setInput("");
  };

  const handleToolResultClick = (toolResult: ToolResult) => {
    const url = buildUrlForToolResult(toolResult);
    if (!url) return;
    router.push(url);
    minimize();
  };

  if (!isOpen || isMinimized) {
    return <FloatingChatLauncher onClick={isMinimized ? restore : open} />;
  }

  return (
    <div className="fixed bottom-4 right-4 z-[70] h-[min(720px,calc(100vh-2rem))] w-[min(460px,calc(100vw-2rem))] overflow-hidden rounded-2xl border bg-background shadow-2xl">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div>
          <p className="text-sm font-medium">OmniPath Assistant</p>
          <p className="text-xs text-muted-foreground">Chat can navigate across pages and open result views.</p>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={minimize}>
            <Minimize2 className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={close}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="h-[calc(100%-57px)]">
        <ChatPanel
          messages={chatMessages}
          input={input}
          handleInputChange={(event) => setInput(event.target.value)}
          handleSubmit={handleSubmit}
          isLoading={isLoading}
          append={(message) =>
            sendMessage({
              role: "user",
              parts: [{ type: "text", text: message.content }],
            })
          }
          reload={() => {
            void regenerate();
          }}
          stop={stop}
          setMessages={(updatedMessages) => setMessages(chatMessagesToUIMessages(updatedMessages))}
          onToolResultClick={handleToolResultClick}
          mode="chat"
          onMaximize={undefined}
        />
      </div>
    </div>
  );
}
