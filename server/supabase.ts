type RestOptions = {
  query?: Record<string, string>;
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  prefer?: string;
};

function getConfig() {
  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new Error("Big 36 Supabase credentials are not configured.");
  return { url: url.replace(/\/$/, ""), secret };
}

export async function supabaseRest<T>(table: string, options: RestOptions = {}): Promise<T> {
  const { url, secret } = getConfig();
  const params = new URLSearchParams(options.query ?? {});
  const response = await fetch(`${url}/rest/v1/${table}${params.size ? `?${params}` : ""}`, {
    method: options.method ?? "GET",
    headers: {
      apikey: secret,
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
      Prefer: options.prefer ?? "return=representation",
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = Array.isArray(payload) ? payload[0]?.message : payload?.message;
    throw new Error(message ?? `Supabase request to ${table} failed (${response.status}).`);
  }
  return payload as T;
}

export async function supabaseRpc<T>(functionName: string, body: Record<string, unknown>): Promise<T> {
  const { url, secret } = getConfig();
  const response = await fetch(`${url}/rest/v1/rpc/${functionName}`, {
    method: "POST",
    headers: { apikey: secret, Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(payload?.message ?? `Supabase function ${functionName} failed (${response.status}).`);
  return payload as T;
}

export const q = {
  eq: (value: string | number | boolean) => `eq.${String(value)}`,
  isNull: "is.null",
};
