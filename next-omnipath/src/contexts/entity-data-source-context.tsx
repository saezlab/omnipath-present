"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { EntityLike } from "@/lib/entities/display";

export interface EntityDataSource {
  getEntity: (entityId: string) => Promise<EntityLike | null>;
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
