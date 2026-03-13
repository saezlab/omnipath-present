"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { MessageSquare } from "lucide-react";
import { ChatPanel } from "./components/chat-panel";
import { chatMessagesToUIMessages, uiMessagesToChatMessages } from "./types";
import { buildUrlForToolResult } from "./tool-result-navigation";
import type { ToolResult } from "./components/dual-mode-interface";

const initialMessages: UIMessage[] = [
  {
    id: "search-assistant-welcome",
    role: "assistant",
    parts: [
      {
        type: "text",
        text: "Use me to control the workspace: I can switch results views and open matching result sets directly.",
      },
    ],
  },
];

export function SearchAssistantPane() {
  const router = useRouter();
  const [input, setInput] = useState("");

  const { messages, sendMessage, status, stop, setMessages, regenerate } = useChat<UIMessage>({
    id: "search-assistant-pane",
    messages: initialMessages,
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
  };

  return (
    <div className="h-full min-h-0 flex flex-col border-t bg-background lg:border-l lg:border-t-0">
      <div className="flex-1 min-h-0">
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
        />
      </div>
    </div>
  );
}
