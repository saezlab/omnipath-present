"use client";

import type { EntitySubsetFilters, InteractionSubsetFilters, SubsetArtifact } from "@/types/subsets";

const DB_NAME = "omnipath-duckdb-cache";
const DB_VERSION = 1;
const SESSION_STORE = "duckdb_sessions";
const ARTIFACT_STORE = "duckdb_artifacts";

export interface CachedDuckDbArtifactMeta {
  id: string;
  resource: "interactions" | "entities";
  fileName: string;
  sizeBytes: number;
  rowCount?: number;
  durationMs?: number;
  createdAt: string;
}

export interface CachedDuckDbSessionRecord {
  id: string;
  label: string;
  cacheKey: string;
  createdAt: string;
  updatedAt: string;
  serverQuery: string;
  serverFilters: InteractionSubsetFilters;
  interactionArtifact: CachedDuckDbArtifactMeta;
  entityArtifact?: CachedDuckDbArtifactMeta;
}

interface CachedDuckDbArtifactRecord extends CachedDuckDbArtifactMeta {
  blob: Blob;
}

interface SaveCachedDuckDbSessionInput {
  label: string;
  cacheKey: string;
  serverQuery: string;
  serverFilters: InteractionSubsetFilters;
  interactionArtifact: SubsetArtifact;
  entityArtifact?: SubsetArtifact;
}

function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function stableSerialize(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));

  return `{${entries
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableSerialize(entryValue)}`)
    .join(",")}}`;
}

export function buildDuckDbSessionCacheKey(filters: InteractionSubsetFilters, query = ""): string {
  return `v1:${stableSerialize({ filters, query })}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(SESSION_STORE)) {
        const sessions = db.createObjectStore(SESSION_STORE, { keyPath: "id" });
        sessions.createIndex("cacheKey", "cacheKey", { unique: false });
        sessions.createIndex("updatedAt", "updatedAt", { unique: false });
      }

      if (!db.objectStoreNames.contains(ARTIFACT_STORE)) {
        db.createObjectStore(ARTIFACT_STORE, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB"));
  });
}

function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function promisifyTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

function toArtifactMeta(artifact: SubsetArtifact, resource: "interactions" | "entities", id: string, createdAt: string): CachedDuckDbArtifactMeta {
  return {
    id,
    resource,
    fileName: artifact.fileName,
    sizeBytes: artifact.blob.size,
    rowCount: artifact.rowCount,
    durationMs: artifact.durationMs,
    createdAt,
  };
}

export async function listCachedDuckDbSessions(): Promise<CachedDuckDbSessionRecord[]> {
  const db = await openDb();
  try {
    const tx = db.transaction(SESSION_STORE, "readonly");
    const sessions = (await promisifyRequest(tx.objectStore(SESSION_STORE).getAll())) as CachedDuckDbSessionRecord[];
    return sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  } finally {
    db.close();
  }
}

export async function getCachedDuckDbSession(id: string): Promise<CachedDuckDbSessionRecord | null> {
  const db = await openDb();
  try {
    const tx = db.transaction(SESSION_STORE, "readonly");
    return ((await promisifyRequest(tx.objectStore(SESSION_STORE).get(id))) as CachedDuckDbSessionRecord | undefined) ?? null;
  } finally {
    db.close();
  }
}

export async function getLatestCachedDuckDbSessionByCacheKey(cacheKey: string): Promise<CachedDuckDbSessionRecord | null> {
  const sessions = await listCachedDuckDbSessions();
  return sessions.find((session) => session.cacheKey === cacheKey) ?? null;
}

export async function loadCachedDuckDbSession(sessionId: string): Promise<{
  session: CachedDuckDbSessionRecord;
  interactionBlob: Blob;
  entityBlob?: Blob;
} | null> {
  const db = await openDb();

  try {
    const tx = db.transaction([SESSION_STORE, ARTIFACT_STORE], "readonly");
    const session = ((await promisifyRequest(tx.objectStore(SESSION_STORE).get(sessionId))) as CachedDuckDbSessionRecord | undefined) ?? null;
    if (!session) return null;

    const interactionArtifact = ((await promisifyRequest(
      tx.objectStore(ARTIFACT_STORE).get(session.interactionArtifact.id),
    )) as CachedDuckDbArtifactRecord | undefined) ?? null;

    if (!interactionArtifact) return null;

    const entityArtifact = session.entityArtifact
      ? (((await promisifyRequest(tx.objectStore(ARTIFACT_STORE).get(session.entityArtifact.id))) as CachedDuckDbArtifactRecord | undefined) ?? null)
      : null;

    return {
      session,
      interactionBlob: interactionArtifact.blob,
      entityBlob: entityArtifact?.blob,
    };
  } finally {
    db.close();
  }
}

export async function saveCachedDuckDbSession(input: SaveCachedDuckDbSessionInput): Promise<CachedDuckDbSessionRecord> {
  const db = await openDb();

  try {
    const existing = await getLatestCachedDuckDbSessionByCacheKey(input.cacheKey);
    const now = new Date().toISOString();
    const interactionArtifactId = existing?.interactionArtifact.id ?? randomId();
    const entityArtifactId = input.entityArtifact ? existing?.entityArtifact?.id ?? randomId() : undefined;

    const interactionArtifactMeta = toArtifactMeta(input.interactionArtifact, "interactions", interactionArtifactId, now);
    const entityArtifactMeta = input.entityArtifact && entityArtifactId
      ? toArtifactMeta(input.entityArtifact, "entities", entityArtifactId, now)
      : undefined;

    const session: CachedDuckDbSessionRecord = {
      id: existing?.id ?? randomId(),
      label: input.label,
      cacheKey: input.cacheKey,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      serverQuery: input.serverQuery,
      serverFilters: input.serverFilters,
      interactionArtifact: interactionArtifactMeta,
      entityArtifact: entityArtifactMeta,
    };

    const tx = db.transaction([SESSION_STORE, ARTIFACT_STORE], "readwrite");
    const artifactStore = tx.objectStore(ARTIFACT_STORE);
    const sessionStore = tx.objectStore(SESSION_STORE);

    artifactStore.put({ ...interactionArtifactMeta, blob: input.interactionArtifact.blob } satisfies CachedDuckDbArtifactRecord);

    if (entityArtifactMeta && input.entityArtifact) {
      artifactStore.put({ ...entityArtifactMeta, blob: input.entityArtifact.blob } satisfies CachedDuckDbArtifactRecord);
    }

    if (!entityArtifactMeta && existing?.entityArtifact?.id) {
      artifactStore.delete(existing.entityArtifact.id);
    }

    sessionStore.put(session);
    await promisifyTransaction(tx);
    return session;
  } finally {
    db.close();
  }
}

export async function deleteCachedDuckDbSession(sessionId: string): Promise<void> {
  const db = await openDb();

  try {
    const tx = db.transaction([SESSION_STORE, ARTIFACT_STORE], "readwrite");
    const sessionStore = tx.objectStore(SESSION_STORE);
    const artifactStore = tx.objectStore(ARTIFACT_STORE);
    const session = ((await promisifyRequest(sessionStore.get(sessionId))) as CachedDuckDbSessionRecord | undefined) ?? null;

    if (session) {
      artifactStore.delete(session.interactionArtifact.id);
      if (session.entityArtifact?.id) {
        artifactStore.delete(session.entityArtifact.id);
      }
      sessionStore.delete(sessionId);
    }

    await promisifyTransaction(tx);
  } finally {
    db.close();
  }
}
