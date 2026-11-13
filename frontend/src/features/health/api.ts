import { apiGet } from "@/lib/api/client";

import {
  isHealthResponse,
  isReadyResponse,
  type HealthResponse,
  type ReadyResponse,
} from "./schema";

export function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return apiGet("/api/v1/health", isHealthResponse, signal);
}

export function fetchReady(signal?: AbortSignal): Promise<ReadyResponse> {
  return apiGet("/api/v1/health/ready", isReadyResponse, signal);
}
