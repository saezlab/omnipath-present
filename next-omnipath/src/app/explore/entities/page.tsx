import Link from "next/link";
import { ArrowRight, Dna, Search, Tags } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const workflows = [
  {
    title: "Entities → Annotations",
    description: "Start with one or more entities, then summarize the annotations and ontology terms connected to them.",
    icon: Dna,
    status: "Next milestone",
  },
  {
    title: "Annotations → Entities",
    description: "Start with ontology terms, then find matching entities and carry them forward into selection or interactions.",
    icon: Tags,
    status: "Next milestone",
  },
  {
    title: "Direct lookup",
    description: "Keep full-text, identifier lookup, and batch lookup as a support workflow for finding exact entities quickly.",
    icon: Search,
    status: "Available now",
  },
] as const;

export default function ExploreEntitiesPage() {
  return (
    <div className="container mx-auto max-w-6xl px-4 py-8 md:py-10">
      <div className="space-y-6">
        <Card className="border-primary/20 bg-gradient-to-br from-primary/5 via-background to-background">
          <CardHeader className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">Entities</Badge>
              <Badge variant="secondary">Workflow redesign in progress</Badge>
            </div>
            <div className="space-y-2">
              <CardTitle className="text-3xl tracking-tight">Entity workflows</CardTitle>
              <CardDescription className="max-w-3xl text-sm md:text-base">
                The entities area is shifting from a generic search page toward clearer workflows. Direct lookup remains available while annotation-oriented flows are being brought into the main app.
              </CardDescription>
            </div>
          </CardHeader>
        </Card>

        <div className="grid gap-4 md:grid-cols-3">
          {workflows.map(({ title, description, icon: Icon, status }) => (
            <Card key={title}>
              <CardHeader className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="rounded-xl border p-2 text-primary">
                    <Icon className="size-4" />
                  </div>
                  <Badge variant={status === "Available now" ? "default" : "outline"}>{status}</Badge>
                </div>
                <div className="space-y-1">
                  <CardTitle className="text-lg">{title}</CardTitle>
                  <CardDescription>{description}</CardDescription>
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Current entry points</CardTitle>
            <CardDescription>
              Use the existing surfaces while the new entity workflows are being integrated.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 sm:flex-row">
            <Button asChild>
              <Link href="/workspace?view=entities">
                Open direct entity lookup
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/selection">Open selection</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/explore/interactions">Open interactions</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
