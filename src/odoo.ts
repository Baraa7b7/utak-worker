// Odoo JSON-2 API client.
// Every call: POST {ODOO_URL}/json/2/{model}/{method}  body = kwargs as JSON
// Auth: X-Api-Key first; on 401 falls back once to /web/session/authenticate and reuses the cookie.

import type { Env } from "./config";
import type { OdooPartner } from "./types";

type AuthMode = "apikey" | "session";

// Module-level auth state — Worker instances are short-lived so this is fine.
// Each new isolate starts fresh, re-does the 401→session dance if needed.
let authMode: AuthMode = "apikey";
let sessionCookie: string | null = null;

async function authenticateSession(env: Env): Promise<void> {
  const res = await fetch(`${env.ODOO_URL}/web/session/authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      params: {
        db: env.ODOO_DB,
        login: env.ODOO_LOGIN,
        password: env.ODOO_API_KEY,
      },
    }),
  });
  const setCookie = res.headers.get("set-cookie") ?? "";
  const match = setCookie.match(/session_id=([^;]+)/);
  if (!match) {
    throw new Error(`odoo session auth failed: no session_id cookie (status ${res.status})`);
  }
  sessionCookie = `session_id=${match[1]}`;
  authMode = "session";
}

async function call<T = unknown>(
  env: Env,
  model: string,
  method: string,
  body: Record<string, unknown>,
): Promise<T> {
  const url = `${env.ODOO_URL}/json/2/${model}/${method}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authMode === "apikey") headers["Authorization"] = `Bearer ${env.ODOO_API_KEY}`;
  if (authMode === "session" && sessionCookie) headers["Cookie"] = sessionCookie;

  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }

  if (!res.ok) {
    // 401 while using X-Api-Key → try session auth once, then retry the call
    if (res.status === 401 && authMode === "apikey") {
      await authenticateSession(env);
      return call<T>(env, model, method, body);
    }
    // deno-lint-ignore no-explicit-any
    const p = parsed as any;
    const errName = p?.data?.name ?? `HTTP_${res.status}`;
    const errMsg = p?.data?.message ?? (typeof text === "string" ? text.slice(0, 200) : "");
    throw Object.assign(new Error(`odoo ${errName}: ${errMsg}`), { status: res.status });
  }

  return parsed as T;
}

// ------------------------------------------------------------
// Typed helpers used by the Worker in v1
// ------------------------------------------------------------

export async function smokeTest(env: Env): Promise<{ ok: boolean; mode: AuthMode; error?: string }> {
  try {
    await call<number>(env, "res.partner", "search_count", { domain: [] });
    return { ok: true, mode: authMode };
  } catch (e) {
    const err = e as Error;
    return { ok: false, mode: authMode, error: err?.message ?? String(e) };
  }
}

export async function findCustomerByWhatsApp(env: Env, e164: string): Promise<OdooPartner | null> {
  const rows = await call<OdooPartner[]>(env, "res.partner", "search_read", {
    domain: [
      "&",
      ["customer_rank", ">", 0],
      "|",
      ["x_whatsapp_number", "=", e164],
      ["mobile", "=", e164],
    ],
    fields: ["id", "name", "customer_rank", "x_whatsapp_number"],
    limit: 1,
  });
  return rows[0] ?? null;
}

export async function findSupplierByWhatsApp(env: Env, e164: string): Promise<OdooPartner | null> {
  const rows = await call<OdooPartner[]>(env, "res.partner", "search_read", {
    domain: [
      ["supplier_rank", ">", 0],
      ["x_whatsapp_number", "=", e164],
    ],
    fields: ["id", "name", "supplier_rank", "x_whatsapp_number"],
    limit: 1,
  });
  return rows[0] ?? null;
}

export async function createCustomer(env: Env, name: string, e164: string): Promise<number> {
  const ids = await call<number[]>(env, "res.partner", "create", {
    vals_list: [
      {
        name: name || e164,
        mobile: e164,
        x_whatsapp_number: e164,
        customer_rank: 1,
      },
    ],
  });
  return ids[0];
}

export async function findOrCreateCustomer(
  env: Env,
  e164: string,
  profileName: string,
): Promise<OdooPartner> {
  const existing = await findCustomerByWhatsApp(env, e164);
  if (existing) return existing;
  const id = await createCustomer(env, profileName, e164);
  return {
    id,
    name: profileName || e164,
    customer_rank: 1,
    x_whatsapp_number: e164,
  };
}
