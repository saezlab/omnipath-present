"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { EntitySearchResult } from "@/types/entities";

export interface EntityDataSource {
  getEntity: (entityId: string) => Promise<EntitySearchResult | null>;
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
