import type { ApiErrorBody } from "@dailyloop/contracts";
let csrf = "";
export class RequestError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
  }
}
export function setCsrf(value: string) {
  csrf = value;
}
export async function request<T>(
  path: string,
  options: {
    body?: unknown;
    operationId?: string;
    signal?: AbortSignal;
    method?: "GET" | "POST" | "PATCH" | "PUT";
  } = {},
): Promise<T> {
  const financial =
    options.body !== undefined &&
    /^\/v1\/(receipts(?:\/|$)|deliveries\/|customers\/[^/]+\/opening-balance$)/.test(
      path,
    );
  if (financial) {
    if (!ownerScope || !options.operationId)
      throw new RequestError(
        401,
        "SESSION_REQUIRED",
        "Sign in before recording a financial entry.",
      );
    const pending = pendingSave();
    if (
      pending &&
      (pending.operationId !== options.operationId ||
        pending.path !== path ||
        JSON.stringify(pending.body) !== JSON.stringify(options.body))
    )
      throw new RequestError(
        409,
        "PENDING_SAVE",
        "Resolve the pending save at the top of the page before recording another entry.",
      );
    savePending({
      path,
      body: options.body,
      operationId: options.operationId,
      createdAt: pending?.createdAt || new Date().toISOString(),
    });
  }
  const result = await fetch(path, {
    method: options.method || (options.body === undefined ? "GET" : "POST"),
    credentials: "same-origin",
    signal: options.signal,
    headers: {
      ...(options.body === undefined
        ? {}
        : { "Content-Type": "application/json", "X-CSRF-Token": csrf }),
      ...(options.operationId
        ? { "Idempotency-Key": options.operationId }
        : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  let payload;
  try {
    payload = await result.json();
  } catch {
    throw new RequestError(
      result.status,
      "SERVER_STARTING",
      "The server may be starting. Please try again shortly.",
    );
  }
  if (!result.ok) {
    if (financial && result.status < 500 && ![401, 403].includes(result.status))
      savePending(null);
    const error = (payload as ApiErrorBody).error;
    throw new RequestError(
      result.status,
      error?.code || "REQUEST_FAILED",
      error?.fieldErrors
        ? Object.entries(error.fieldErrors)
            .map(([field, messages]) => field + ": " + messages.join(" "))
            .join("; ") || error.message
        : error?.message || "Could not complete the request.",
      error?.fieldErrors,
    );
  }
  if (financial) savePending(null);
  return payload.data as T;
}

export async function download(
  path: string,
  filename: string,
  options: { body?: unknown; operationId?: string } = {},
) {
  const response = await fetch(path, {
    method: options.body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers: {
      ...(options.body === undefined
        ? {}
        : { "Content-Type": "application/json", "X-CSRF-Token": csrf }),
      ...(options.operationId
        ? { "Idempotency-Key": options.operationId }
        : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new RequestError(
      response.status,
      data?.error?.code || "DOWNLOAD_FAILED",
      data?.error?.message || "Download failed. Try again.",
    );
  }
  const url = URL.createObjectURL(await response.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export type PendingSave = {
  path: string;
  body: unknown;
  operationId: string;
  createdAt: string;
};
let ownerScope = "";
const pendingKey = () => `dailyloop-pending-v1:${ownerScope}`;
export function setOwnerScope(id: string) {
  ownerScope = id;
  if (id) {
    try {
      for (const key of Object.keys(sessionStorage))
        if (key.startsWith("dailyloop-pending-v1:") && key !== pendingKey())
          sessionStorage.removeItem(key);
    } catch {
      /* Financial writes will fail closed if tab storage is unavailable. */
    }
  }
  window.dispatchEvent(new Event("dailyloop-pending"));
}
export function pendingSave(): PendingSave | null {
  if (!ownerScope) return null;
  try {
    return JSON.parse(sessionStorage.getItem(pendingKey()) || "null");
  } catch {
    return null;
  }
}
function savePending(value: PendingSave | null) {
  if (!ownerScope) return;
  try {
    if (value) sessionStorage.setItem(pendingKey(), JSON.stringify(value));
    else sessionStorage.removeItem(pendingKey());
  } catch {
    throw new RequestError(
      503,
      "BROWSER_STORAGE_REQUIRED",
      "Allow tab storage before recording financial entries so interrupted saves can be recovered.",
    );
  }
  window.dispatchEvent(new Event("dailyloop-pending"));
}
