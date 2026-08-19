import { describe, expect, it } from "vitest";
import { isShareCrawler, shareCardHtml } from "./share-preview";

describe("36 Football share preview", () => {
  it("uses the official league wordmark for social crawler cards", () => {
    const card = shareCardHtml("/join");
    const expectedImage = "https://36football.com/manus-storage/36football-helmet-wordmark-512_d0952170.png";
    expect(card).toContain(`<meta property="og:image" content="${expectedImage}" />`);
    expect(card).toContain(`<meta name="twitter:image" content="${expectedImage}" />`);
    expect(card).toContain('content="https://36football.com/join"');
  });

  it("recognizes social-preview crawlers without intercepting normal visitors", () => {
    expect(isShareCrawler("facebookexternalhit/1.1")).toBe(true);
    expect(isShareCrawler("Twitterbot/1.0")).toBe(true);
    expect(isShareCrawler("Mozilla/5.0")).toBe(false);
  });
});
