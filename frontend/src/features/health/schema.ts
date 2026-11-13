export type HealthResponse = { status: "ok" };

export type ReadyResponse = {
  status: "ok" | "unavailable";
  database: "ok" | "error";
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isHealthResponse(value: unknown): value is HealthResponse {
  return isRecord(value) && value.status === "ok";
}

export function isReadyResponse(value: unknown): value is ReadyResponse {
  return (
    isRecord(value) &&
    (value.status === "ok" || value.status === "unavailable") &&
    (value.database === "ok" || value.database === "error")
  );
}
