import { Suspense } from "react";

import { SelectionResultsView } from "@/features/workspace/views/selection-results-view";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <SelectionResultsView />
    </Suspense>
  );
}
