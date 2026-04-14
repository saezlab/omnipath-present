import { Suspense } from "react";
import { DuckDbWorkspaceShell } from "@/features/duckdb/workspace/workspace-shell";

export default function DuckDbWorkspacePage() {
  return (
    <Suspense fallback={<div className="flex h-svh flex-1" />}>
      <DuckDbWorkspaceShell />
    </Suspense>
  );
}
