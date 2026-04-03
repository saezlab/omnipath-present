import ResourcesPage from "@/features/resources/page";
import { getResources, summarizeResources } from "@/lib/resources";

export const dynamic = "force-dynamic";

export default async function Page() {
  const resources = await getResources();
  const summary = summarizeResources(resources);

  return <ResourcesPage resources={resources} summary={summary} />;
}
