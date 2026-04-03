"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { SearchResult } from "@/features/search/components/result-card";

export interface EntityDataSource {
  getEntity: (entityId: string) => Promise<SearchResult | null>;
}

const EntityDataSourceContext = createContext<EntityDataSource | null>(null);

export function EntityDataSourceProvider({
  value,
  children,
}: {
  value: EntityDataSource;
  children: ReactNode;
}) {
  return <EntityDataSourceContext.Provider value={value}>{children}</EntityDataSourceContext.Provider>;
}

export function useEntityDataSource() {
  return useContext(EntityDataSourceContext);
}
