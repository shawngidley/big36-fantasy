// One-time migration: move the 4 static brand PNGs and every existing
// user-uploaded team logo off Manus's storage proxy (still live at
// https://36football.com/manus-storage/{key} until DNS cuts over) and onto
// Supabase Storage. Run this BEFORE the DNS cutover, since it depends on the
// old Manus-hosted proxy still resolving.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SECRET_KEY=... node scripts/migrate-storage-to-supabase.mjs
//   APPLY=true SUPABASE_URL=... SUPABASE_SECRET_KEY=... node scripts/migrate-storage-to-supabase.mjs
//
// Without APPLY=true this only reports what it would do (dry run).

const apply = process.env.APPLY === "true";
const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
const supabaseKey = process.env.SUPABASE_SECRET_KEY;
if (!supabaseUrl || !supabaseKey) throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are required.");

const MANUS_BASE = "https://36football.com/manus-storage";
const BRAND_ASSETS_BUCKET = "brand-assets";
const TEAM_LOGOS_BUCKET = "team-logos";

const BRAND_ASSETS = [
  "36football-helmet-wordmark-512_d0952170.png",
  "36football-helmet-icon-192_6d7e3e68.png",
  "36football-helmet-icon-512_53e09209.png",
  "36football-helmet-wordmark-192_f71497b3.png",
];

async function ensureBucket(name) {
  const resp = await fetch(`${supabaseUrl}/storage/v1/bucket`, {
    method: "POST",
    headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, public: true }),
  });
  if (resp.ok) {
    console.log(`Created bucket "${name}".`);
    return;
  }
  const detail = await resp.text().catch(() => "");
  if (resp.status === 409 || /already exists/i.test(detail)) {
    console.log(`Bucket "${name}" already exists.`);
    return;
  }
  throw new Error(`Failed to create bucket "${name}" (${resp.status}): ${detail}`);
}

async function uploadToBucket(bucket, key, bytes, contentType) {
  if (!apply) return `${supabaseUrl}/storage/v1/object/public/${bucket}/${key}`;
  const resp = await fetch(`${supabaseUrl}/storage/v1/object/${bucket}/${key}`, {
    method: "POST",
    headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, "Content-Type": contentType, "x-upsert": "true" },
    body: bytes,
  });
  if (!resp.ok) throw new Error(`Upload to ${bucket}/${key} failed (${resp.status}): ${await resp.text().catch(() => "")}`);
  return `${supabaseUrl}/storage/v1/object/public/${bucket}/${key}`;
}

async function fetchManusAsset(key) {
  const resp = await fetch(`${MANUS_BASE}/${key}`);
  if (!resp.ok) throw new Error(`Fetching ${MANUS_BASE}/${key} failed (${resp.status}). Is the Manus deployment still live?`);
  const contentType = resp.headers.get("content-type") ?? "application/octet-stream";
  return { bytes: Buffer.from(await resp.arrayBuffer()), contentType };
}

async function supabaseRest(table, { query, method = "GET", body } = {}) {
  const params = new URLSearchParams(query ?? {});
  const resp = await fetch(`${supabaseUrl}/rest/v1/${table}${params.size ? `?${params}` : ""}`, {
    method,
    headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await resp.text();
  const payload = text ? JSON.parse(text) : null;
  if (!resp.ok) throw new Error(`Supabase ${table} request failed (${resp.status}): ${JSON.stringify(payload)}`);
  return payload;
}

async function migrateBrandAssets() {
  await ensureBucket(BRAND_ASSETS_BUCKET);
  const results = [];
  for (const key of BRAND_ASSETS) {
    const { bytes, contentType } = await fetchManusAsset(key);
    const url = await uploadToBucket(BRAND_ASSETS_BUCKET, key, bytes, contentType);
    results.push({ key, url });
    console.log(`${apply ? "Uploaded" : "Would upload"} brand asset ${key} -> ${url}`);
  }
  return results;
}

function manusKeyFromUrl(url) {
  if (!url || !url.includes("/manus-storage/")) return null;
  return url.split("/manus-storage/")[1];
}

async function migrateOwnerRegistrationLogos() {
  const rows = await supabaseRest("b36_owner_registrations", { query: { select: "id,logo_key,logo_url" } });
  const withLogo = rows.filter(row => manusKeyFromUrl(row.logo_url));
  console.log(`${withLogo.length} b36_owner_registrations row(s) with a Manus-hosted logo.`);
  for (const row of withLogo) {
    const key = manusKeyFromUrl(row.logo_url);
    const { bytes, contentType } = await fetchManusAsset(key);
    const url = await uploadToBucket(TEAM_LOGOS_BUCKET, key, bytes, contentType);
    console.log(`${apply ? "Migrated" : "Would migrate"} registration ${row.id}: ${row.logo_url} -> ${url}`);
    if (apply) await supabaseRest("b36_owner_registrations", { method: "PATCH", query: { id: `eq.${row.id}` }, body: { logo_key: key, logo_url: url } });
  }
}

async function migrateOwnerLogos() {
  const rows = await supabaseRest("b36_owners", { query: { select: "id,logo_url" } });
  const withLogo = rows.filter(row => manusKeyFromUrl(row.logo_url));
  console.log(`${withLogo.length} b36_owners row(s) with a Manus-hosted logo.`);
  for (const row of withLogo) {
    const key = manusKeyFromUrl(row.logo_url);
    const { bytes, contentType } = await fetchManusAsset(key);
    const newKey = `owner-profiles/${row.id}/${key}`;
    const url = await uploadToBucket(TEAM_LOGOS_BUCKET, newKey, bytes, contentType);
    console.log(`${apply ? "Migrated" : "Would migrate"} owner ${row.id}: ${row.logo_url} -> ${url}`);
    if (apply) await supabaseRest("b36_owners", { method: "PATCH", query: { id: `eq.${row.id}` }, body: { logo_url: url } });
  }
}

await ensureBucket(TEAM_LOGOS_BUCKET);
const brandAssetResults = await migrateBrandAssets();
await migrateOwnerRegistrationLogos();
await migrateOwnerLogos();

if (!apply) {
  console.log("\nDry run only. Re-run with APPLY=true to actually upload and update rows.");
}
console.log("\nOnce applied, replace the hardcoded https://36football.com/manus-storage/... references with these brand asset URLs before DNS cutover:");
for (const { key, url } of brandAssetResults) console.log(`  ${key} -> ${url}`);
console.log("Reference sites: client/index.html, client/public/36football-pwa-0336c5e3.webmanifest, client/public/site.webmanifest, client/src/components/LeagueShell.tsx (+ their tests).");
