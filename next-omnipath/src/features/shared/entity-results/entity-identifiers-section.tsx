"use client";

import { useMemo, useState, type MouseEvent } from "react";
import { Check, ChevronDown, ChevronUp, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { getIdentifierTypeLabel } from "@/lib/entities/display";
import type { Identifier } from "@/types/entities";

type ParsedIdentifier = {
  type: string;
  rawType: string;
  value: string;
  rank: number;
};

function rankIdentifierType(label: string): number {
  const normalized = label.toLowerCase();
  if (normalized.includes("gene name primary") || normalized === "name") return 0;
  if (normalized.includes("uniprot") || normalized.includes("chebi") || normalized.includes("pubchem") || normalized.includes("hmdb")) return 1;
  if (normalized.includes("ensembl") || normalized.includes("entrez") || normalized.includes("kegg") || normalized.includes("chembl") || normalized.includes("drugbank")) return 2;
  if (normalized.includes("smiles") || normalized.includes("inchi") || normalized.includes("molecular formula")) return 3;
  if (normalized.includes("synonym") || normalized.includes("systematic")) return 4;
  if (normalized.includes("local")) return 5;
  return 6;
}

function normalizeIdentifier(identifier: Identifier): ParsedIdentifier | null {
  const rawType = identifier?.key?.trim();
  const value = identifier?.value?.trim();
  if (!rawType || !value) return null;
  const type = getIdentifierTypeLabel(rawType);
  return { type, rawType, value, rank: rankIdentifierType(type) };
}

function useParsedIdentifiers(identifiers: Identifier[]): ParsedIdentifier[] {
  return useMemo(() => {
    const seen = new Set<string>();
    return identifiers
      .map(normalizeIdentifier)
      .filter((identifier): identifier is ParsedIdentifier => Boolean(identifier))
      .filter((identifier) => {
        const key = `${identifier.rawType}\u0000${identifier.value}`.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => a.rank - b.rank || a.type.localeCompare(b.type) || a.value.localeCompare(b.value));
  }, [identifiers]);
}

function IdentifierRow({ identifier }: { identifier: ParsedIdentifier }) {
  const [copied, setCopied] = useState(false);

  const copy = (event: MouseEvent) => {
    event.stopPropagation();
    void navigator.clipboard.writeText(identifier.value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="group/id grid grid-cols-[minmax(7rem,12rem)_1fr_auto] items-start gap-2 rounded-md border bg-background/80 px-2 py-1.5 text-xs">
      <div className="font-medium text-muted-foreground" title={identifier.rawType}>{identifier.type}</div>
      <div className="min-w-0 break-all font-mono text-foreground" title={identifier.value}>{identifier.value}</div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={copy}
        className="h-6 w-6 opacity-70 transition-opacity group-hover/id:opacity-100"
        title="Copy identifier"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
}

export function EntityIdentifiersSection({ identifiers, defaultOpen = false, className = "" }: {
  identifiers: Identifier[];
  defaultOpen?: boolean;
  className?: string;
}) {
  const parsedIdentifiers = useParsedIdentifiers(identifiers);
  const [open, setOpen] = useState(defaultOpen);

  if (parsedIdentifiers.length === 0) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className={className}>
      <div className="border-t bg-muted/30 px-3 py-2">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            onClick={(event) => event.stopPropagation()}
          >
            <span>Identifiers ({parsedIdentifiers.length})</span>
            {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent onClick={(event) => event.stopPropagation()}>
          <div className="mt-2 max-h-72 space-y-1.5 overflow-y-auto pr-1">
            {parsedIdentifiers.map((identifier) => (
              <IdentifierRow key={`${identifier.rawType}:${identifier.value}`} identifier={identifier} />
            ))}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
