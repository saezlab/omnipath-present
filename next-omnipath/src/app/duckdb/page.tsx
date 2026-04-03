import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function DuckDbLandingPage() {
  return (
    <div className="container mx-auto flex min-h-[calc(100svh-4rem)] max-w-4xl items-center px-4 py-10">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>DuckDB prototype area</CardTitle>
          <CardDescription>
            Parallel workspace for validating server-materialized Parquet subsets + DuckDB WASM.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/duckdb/workspace?view=interactions">Open DuckDB workspace</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
