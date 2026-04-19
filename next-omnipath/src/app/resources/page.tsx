import ResourcesPage from "@/features/resources/page";
import { listResources, summarizeResources } from "@/lib/resource";

export const dynamic = "force-dynamic";

export default async function Page() {
  const resources = await listResources();
  const summary = summarizeResources(resources);

  return <ResourcesPage resources={resources} summary={summary} />;
}
