// File storage backed by Supabase Storage (bucket: team-logos, public read).
// Uploads write directly to the bucket and return its public URL.

const TEAM_LOGOS_BUCKET = "team-logos";

function getConfig() {
  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new Error("Big 36 Supabase credentials are not configured.");
  return { url: url.replace(/\/$/, ""), secret };
}

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

function appendHashSuffix(relKey: string): string {
  const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const lastDot = relKey.lastIndexOf(".");
  if (lastDot === -1) return `${relKey}_${hash}`;
  return `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`;
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream",
): Promise<{ key: string; url: string }> {
  const { url, secret } = getConfig();
  const key = appendHashSuffix(normalizeKey(relKey));
  const body = typeof data === "string" ? Buffer.from(data) : Buffer.from(data);

  const uploadResp = await fetch(`${url}/storage/v1/object/${TEAM_LOGOS_BUCKET}/${key}`, {
    method: "POST",
    headers: {
      apikey: secret,
      Authorization: `Bearer ${secret}`,
      "Content-Type": contentType,
      "x-upsert": "false",
    },
    body,
  });

  if (!uploadResp.ok) {
    const msg = await uploadResp.text().catch(() => uploadResp.statusText);
    throw new Error(`Storage upload to Supabase failed (${uploadResp.status}): ${msg}`);
  }

  return { key, url: `${url}/storage/v1/object/public/${TEAM_LOGOS_BUCKET}/${key}` };
}
