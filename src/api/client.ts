import type { ApiClient, Config } from "../types.ts";

const REQUEST_TIMEOUT_MS = 10000; // 10 seconds

export function createApi(config: Config): ApiClient {
  const base = `https://${config.site}`;
  const auth = `Basic ${btoa(`${config.token}:X`)}`;

  async function get<T>(path: string): Promise<T> {
    const res = await fetch(`${base}${path}`, {
      headers: { Authorization: auth, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`API ${res.status}${body ? `: ${body}` : ""}`);
    }
    return res.json() as Promise<T>;
  }

  async function post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      const b = await res.text().catch(() => "");
      throw new Error(`API ${res.status}${b ? `: ${b}` : ""}`);
    }
    return res.json() as Promise<T>;
  }

  async function put(path: string, body?: unknown): Promise<void> {
    const res = await fetch(`${base}${path}`, {
      method: "PUT",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      const b = await res.text().catch(() => "");
      throw new Error(`API ${res.status}${b ? `: ${b}` : ""}`);
    }
  }

  async function del(path: string): Promise<void> {
    const res = await fetch(`${base}${path}`, {
      method: "DELETE",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      const b = await res.text().catch(() => "");
      throw new Error(`API ${res.status}${b ? `: ${b}` : ""}`);
    }
  }

  return { get, post, put, delete: del };
}
