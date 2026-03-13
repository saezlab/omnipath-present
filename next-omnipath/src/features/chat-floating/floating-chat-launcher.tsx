"use client";

import { Button } from "@/components/ui/button";
import { MessageSquare } from "lucide-react";

export function FloatingChatLauncher({ onClick }: { onClick: () => void }) {
  return (
    <Button
      onClick={onClick}
      size="lg"
      className="fixed bottom-4 right-4 z-[70] h-12 rounded-full px-4 shadow-lg"
    >
      <MessageSquare className="mr-2 h-4 w-4" />
      Assistant
    </Button>
  );
}
