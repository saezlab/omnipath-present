"use client";

import * as duckdb from "@duckdb/duckdb-wasm";

let dbPromise: Promise<duckdb.AsyncDuckDB> | null = null;
const transientObjectUrls = new Set<string>();

async function toObjectUrl(url: string, mimeType: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch DuckDB asset: ${url} (${response.status})`);
  }

  const bytes = await response.arrayBuffer();
  const objectUrl = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  transientObjectUrls.add(objectUrl);
  return objectUrl;
}

async function getBrowserSafeBundle(): Promise<duckdb.DuckDBBundle> {
  const bundles = duckdb.getJsDelivrBundles();
  const selected = await duckdb.selectBundle(bundles);

  return {
    mainModule: await toObjectUrl(selected.mainModule, "application/wasm"),
    mainWorker: selected.mainWorker ? await toObjectUrl(selected.mainWorker, "text/javascript") : null,
    pthreadWorker: selected.pthreadWorker
      ? await toObjectUrl(selected.pthreadWorker, "text/javascript")
      : null,
  };
}

async function createDuckDb(): Promise<duckdb.AsyncDuckDB> {
  const bundle = await getBrowserSafeBundle();
  const worker = new Worker(bundle.mainWorker!);
  const logger = new duckdb.VoidLogger();
  const db = new duckdb.AsyncDuckDB(logger, worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  return db;
}

export async function getDuckDb(): Promise<duckdb.AsyncDuckDB> {
  if (!dbPromise) {
    dbPromise = createDuckDb();
  }

  return dbPromise;
}

export async function registerParquetFile(fileName: string, blob: Blob): Promise<void> {
  const db = await getDuckDb();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  await db.registerFileBuffer(fileName, bytes);
}

export async function createConnection(): Promise<duckdb.AsyncDuckDBConnection> {
  const db = await getDuckDb();
  return db.connect();
}

export async function releaseObjectUrl(url: string | undefined) {
  if (!url) return;
  URL.revokeObjectURL(url);
}

export async function releaseDuckDbAssets() {
  for (const url of transientObjectUrls) {
    URL.revokeObjectURL(url);
  }
  transientObjectUrls.clear();
}
