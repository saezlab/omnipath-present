"use client";

import type { ReactNode } from "react";
export { useEntitySelection, type SelectedAnnotation, type SelectedEntity } from "@/lib/navigation/url-state";

export function EntitySelectionProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
