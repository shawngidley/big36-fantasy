import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("36 Football share preview", () => {
  it("uses the official league wordmark for Open Graph and text-share images", () => {
    const documentHead = readFileSync(resolve(process.cwd(), "client/index.html"), "utf8");
    const expectedImage = "https://36football.com/manus-storage/36football-helmet-wordmark-512_d0952170.png";
    expect(documentHead).toContain(`<meta property="og:image" content="${expectedImage}" />`);
    expect(documentHead).toContain(`<meta name="twitter:image" content="${expectedImage}" />`);
  });
});
