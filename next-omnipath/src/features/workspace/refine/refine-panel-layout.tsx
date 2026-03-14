"use client";

import type { ReactNode } from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { cn } from "@/lib/utils";

interface RefinePanelLayoutProps {
  title: string;
  children: ReactNode;
}

interface RefineSectionProps {
  title: string;
  children: ReactNode;
  className?: string;
  defaultOpen?: boolean;
}

export function RefinePanelLayout({ title, children }: RefinePanelLayoutProps) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="border-b px-4 py-4 md:px-5">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 md:px-5">
        <div className="space-y-4">{children}</div>
      </div>
    </div>
  );
}

export function RefineSection({
  title,
  children,
  className,
  defaultOpen = true,
}: RefineSectionProps) {
  return (
    <Accordion type="single" collapsible defaultValue={defaultOpen ? "content" : undefined} className={cn("rounded-xl border bg-card/60", className)}>
      <AccordionItem value="content" className="border-b-0">
        <AccordionTrigger className="px-4 py-3 hover:no-underline">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          </div>
        </AccordionTrigger>
        <AccordionContent className="px-4 pb-4">
          {children}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
