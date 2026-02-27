"use client";

import { useState } from "react";
import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { SiteLayout } from "@/components/layout/main-layout";
import { DualModeInterface } from "./components/dual-mode-interface";
import { chatMessagesToUIMessages, uiMessagesToChatMessages } from "./types";

export default function ChatPage() {
  const [input, setInput] = useState("");

  const initialMessages: UIMessage[] = [
    {
      id: "1",
      role: "assistant",
      parts: [
        {
          type: "text",
          text: "Hello! I'm OmniPath AI. I can help you explore protein interactions, pathways, and biological annotations. What would you like to know?",
        },
      ],
    },
  ];

  const { messages, sendMessage, status, stop, setMessages, regenerate } = useChat<UIMessage>({
    id: "main-chat",
    messages: initialMessages,
  });

  const chatMessages = uiMessagesToChatMessages(messages);
  const isLoading = status === "submitted" || status === "streaming";

  const handleInputChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(event.target.value);
  };

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

  return (
    <SiteLayout>
      <div className="flex-1 flex flex-col h-[100vh]">
        <DualModeInterface
          messages={chatMessages}
          input={input}
          handleInputChange={handleInputChange}
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
        />
      </div>
    </SiteLayout>
  );
}
