export interface ApiErrorBody {
  readonly error?: { readonly code?: string; readonly message?: string };
  readonly ok?: boolean;
}

export async function apiRequest<T>(
  path: string,
  csrfToken: string,
  options: { body?: unknown; method: "DELETE" | "PATCH" | "POST" },
): Promise<T> {
  const response = await fetch(path, {
    body: JSON.stringify(options.body ?? {}),
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken,
    },
    method: options.method,
  });
  const json = await response.json<ApiErrorBody & { data?: T }>();
  if (!response.ok || json.ok !== true || json.data === undefined) {
    throw new Error(json.error?.message ?? "操作失敗，請稍後再試");
  }
  return json.data;
}
