import { json } from "@sveltejs/kit";

export function jsonBigIntSafe(data: unknown, init?: ResponseInit) {
  const serialized = JSON.stringify(data, (_key, value) =>
    typeof value === "bigint" ? Number(value) : value,
  );
  return new Response(serialized, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}
