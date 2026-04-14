import { Suspense } from "react";
import { DuckDbResourceWorkspaceShell } from "@/features/duckdb/resources/workspace-shell";

export default function DuckDbResourcesWorkspacePage() {
  return (
    <Suspense fallback={<div className="flex h-svh flex-1" />}>
      <DuckDbResourceWorkspaceShell />
    </Suspense>
  );
}
