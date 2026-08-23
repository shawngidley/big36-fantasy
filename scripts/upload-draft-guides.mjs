// One-time upload: push the 6 draft guide PDFs to Supabase Storage so the
// Draft Guide page can link to them.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SECRET_KEY=... node scripts/upload-draft-guides.mjs
//   APPLY=true SUPABASE_URL=... SUPABASE_SECRET_KEY=... node scripts/upload-draft-guides.mjs
//
// Without APPLY=true this only reports what it would do (dry run).

import { readFile } from "node:fs/promises";
import path from "node:path";

const apply = process.env.APPLY === "true";
const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
const supabaseKey = process.env.SUPABASE_SECRET_KEY;
if (!supabaseUrl || !supabaseKey) throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are required.");

const BUCKET = "draft-guides";
const SOURCE_DIR = path.join(process.cwd(), "assets", "draft-guides");

const GUIDES = [
  { file: "QB.pdf", key: "qb-guide.pdf" },
  { file: "RB.pdf", key: "rb-guide.pdf" },
  { file: "WR.pdf", key: "wr-guide.pdf" },
  { file: "TE.pdf", key: "te-guide.pdf" },
  { file: "KST.pdf", key: "kst-guide.pdf" },
  { file: "DEF.pdf", key: "def-guide.pdf" },
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

async function uploadToBucket(bucket, key, bytes) {
  const publicUrl = `${supabaseUrl}/storage/v1/object/public/${bucket}/${key}`;
  if (!apply) return publicUrl;
  const resp = await fetch(`${supabaseUrl}/storage/v1/object/${bucket}/${key}`, {
    method: "POST",
    headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, "Content-Type": "application/pdf", "x-upsert": "true" },
    body: bytes,
  });
  if (!resp.ok) throw new Error(`Upload to ${bucket}/${key} failed (${resp.status}): ${await resp.text().catch(() => "")}`);
  return publicUrl;
}

async function main() {
  await ensureBucket(BUCKET);
  const results = [];
  for (const guide of GUIDES) {
    const bytes = await readFile(path.join(SOURCE_DIR, guide.file));
    const url = await uploadToBucket(BUCKET, guide.key, bytes);
    results.push({ ...guide, url });
    console.log(`${apply ? "Uploaded" : "Would upload"} ${guide.file} -> ${url}`);
  }
  if (!apply) console.log("\nDry run only. Re-run with APPLY=true to actually upload.");
  return results;
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
