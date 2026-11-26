const configuredApiBase = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/$/, "") ?? "";

/** Route SideQuest API requests through one configurable base. External services
 * passed to this helper remain direct requests and never receive API cookies. */
export function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (typeof input === "string" && (input === "/api" || input.startsWith("/api/"))) {
    return fetch(`${configuredApiBase}${input}`, { ...init, credentials: init?.credentials ?? "include" });
  }
  return fetch(input, init);
}
