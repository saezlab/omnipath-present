"use client";

import { Database, HardDriveDownload, RefreshCw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useDuckDbWorkspace } from "./context";

function formatBytes(value: number | undefined): string {
  if (!value || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size >= 100 || unitIndex === 0 ? Math.round(size) : size.toFixed(1)} ${units[unitIndex]}`;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function DuckDbChatPane() {
  const {
    activeSessionId,
    deleteSavedSession,
    loadSavedSession,
    loading,
    refreshSubset,
    savedSessions,
    savedSessionsLoading,
  } = useDuckDbWorkspace();

  return (
    <div className="h-full overflow-auto p-4">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>DuckDB workspace notes</CardTitle>
            <CardDescription>
              This parallel workspace keeps the main Meilisearch-backed workspace intact while we validate
              subset delivery + DuckDB WASM.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>Current prototype scope:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Materialize interaction subsets from the existing Parquet export API.</li>
              <li>Load the artifact directly in-browser with DuckDB WASM.</li>
              <li>Cache datasets locally in IndexedDB for fast reopen after refresh.</li>
              <li>Run local filtering, counts, and pagination without another backend search roundtrip.</li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <HardDriveDownload className="size-4" />
              Saved datasets
            </CardTitle>
            <CardDescription>
              Previously loaded DuckDB subsets stored locally in your browser.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => void refreshSubset()} disabled={loading}>
                <RefreshCw className="size-4" />
                Refresh current filters from server
              </Button>
            </div>

            {savedSessionsLoading ? (
              <div className="text-sm text-muted-foreground">Loading saved datasets…</div>
            ) : savedSessions.length === 0 ? (
              <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                No local DuckDB datasets saved yet. Materialize a subset to cache it here.
              </div>
            ) : (
              <div className="space-y-3">
                {savedSessions.map((session) => {
                  const totalBytes = session.interactionArtifact.sizeBytes + (session.entityArtifact?.sizeBytes ?? 0);
                  const isActive = session.id === activeSessionId;

                  return (
                    <div key={session.id} className="rounded-lg border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="truncate text-sm font-medium">{session.label}</div>
                            {isActive ? <Badge variant="secondary">Current</Badge> : null}
                          </div>
                          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                            <span>Saved {formatTimestamp(session.updatedAt)}</span>
                            {typeof session.interactionArtifact.rowCount === "number" ? (
                              <span>{session.interactionArtifact.rowCount.toLocaleString()} rows</span>
                            ) : null}
                            <span>{formatBytes(totalBytes)}</span>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Badge variant="outline">Interactions parquet</Badge>
                            {session.entityArtifact ? <Badge variant="outline">Entities parquet</Badge> : null}
                            {session.serverFilters.entity_ids?.length ? (
                              <Badge variant="outline">Entity scope {session.serverFilters.entity_ids.length}</Badge>
                            ) : null}
                          </div>
                        </div>
                        <Database className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      </div>

                      <div className="mt-3 flex gap-2">
                        <Button size="sm" variant={isActive ? "secondary" : "outline"} onClick={() => void loadSavedSession(session.id)} disabled={loading && isActive}>
                          Open cached dataset
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => void deleteSavedSession(session.id)}>
                          <Trash2 className="size-4" />
                          Delete
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
