import { Suspense } from "react";
import { DuckDbAnnotationWorkspaceShell } from "@/features/duckdb/annotations/workspace-shell";

export default function DuckDbAnnotationsWorkspacePage() {
  return (
    <Suspense fallback={<div className="flex h-svh flex-1" />}>
      <DuckDbAnnotationWorkspaceShell />
    </Suspense>
  );
}
