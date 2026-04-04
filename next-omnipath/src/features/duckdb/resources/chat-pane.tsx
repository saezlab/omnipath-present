"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useDuckDbResourceWorkspace } from "./context";

export function DuckDbResourceChatPane() {
  const { resourceIds, rowCount, materialized } = useDuckDbResourceWorkspace();

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden p-4">
      <Card className="flex-1">
        <CardHeader>
          <CardTitle>Dataset info</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div>
            <div className="mb-2 font-medium">Resources</div>
            <div className="flex flex-wrap gap-2">
              {resourceIds.map((resourceId) => <Badge key={resourceId} variant="outline">{resourceId}</Badge>)}
            </div>
          </div>
          <div className="text-muted-foreground">
            {materialized
              ? `Loaded ${typeof rowCount === "number" ? rowCount.toLocaleString() : ""} interactions from raw gold artifacts.`
              : "Load selected resources to inspect them locally in DuckDB."}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
