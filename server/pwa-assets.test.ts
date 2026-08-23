import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(import.meta.dirname, "..");
const readProjectFile = (relativePath: string) => readFileSync(resolve(projectRoot, relativePath), "utf8");

describe("36 Football PWA asset wiring", () => {
  it("uses the versioned helmet-only icon assets for the manifest, favicon, and Apple touch icon", () => {
    const manifest = readProjectFile("client/public/36football-pwa-0336c5e3.webmanifest");
    const documentHead = readProjectFile("client/index.html");
    const compactSpec = readProjectFile("research/pwa_compact_asset_spec.md");

    expect(manifest).toContain('"src": "https://fjzlwifohkehwymisaoh.supabase.co/storage/v1/object/public/brand-assets/36football-helmet-icon-192_6d7e3e68.png"');
    expect(manifest).toContain('"src": "https://fjzlwifohkehwymisaoh.supabase.co/storage/v1/object/public/brand-assets/36football-helmet-icon-512_53e09209.png"');
    expect(manifest).not.toContain("wordmark");
    expect(compactSpec).toContain("36football-helmet-icon-192_6d7e3e68.png");
    expect(compactSpec).toContain("36football-helmet-icon-512_53e09209.png");
    expect(compactSpec).toContain("Must contain no text other than the helmet's `36` mark");
    expect(compactSpec).toContain("Both direct binary inspections show the helmet and `36` decal only; no `FOOTBALL` wordmark or season line");
    expect(compactSpec).toContain("a6828386213071075eb1343783ceded082df0b5855228eb808cd8a7dc5419b4d");
    expect(compactSpec).toContain("008ff434ad20a5c1188381d953bd70fdd48d1bd8fa24076f9ac6b5d07a42e200");
    expect(documentHead).toContain('rel="manifest" href="/36football-pwa-0336c5e3.webmanifest"');
    expect(documentHead).toContain('rel="icon" type="image/png" sizes="192x192" href="https://fjzlwifohkehwymisaoh.supabase.co/storage/v1/object/public/brand-assets/36football-helmet-icon-192_6d7e3e68.png"');
    expect(documentHead).toContain('rel="apple-touch-icon" href="https://fjzlwifohkehwymisaoh.supabase.co/storage/v1/object/public/brand-assets/36football-helmet-icon-192_6d7e3e68.png"');
  });

  it("keeps the full helmet-and-wordmark asset in the shared public header", () => {
    const leagueShell = readProjectFile("client/src/components/LeagueShell.tsx");
    expect(leagueShell).toContain('src="https://fjzlwifohkehwymisaoh.supabase.co/storage/v1/object/public/brand-assets/36football-helmet-wordmark-192_f71497b3.png"');
  });
});
