import type { Request, Response } from "express";

const SHARE_CRAWLER_PATTERN = /facebookexternalhit|facebot|twitterbot|xbot|linkedinbot|slackbot|discordbot|telegrambot|whatsapp|wechat|imessage|pinterest/i;
const SHARE_IMAGE = "https://36football.com/manus-storage/36football-helmet-wordmark-512_d0952170.png";

const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export const isShareCrawler = (userAgent: string | undefined) => Boolean(userAgent && SHARE_CRAWLER_PATTERN.test(userAgent));

export const shareCardHtml = (url: string) => {
  const canonicalUrl = url.startsWith("/") ? `https://36football.com${url}` : "https://36football.com";
  const title = "36 Football — Inaugural Season";
  const description = "Build your program and join the inaugural 36 Football field.";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}" /><meta property="og:type" content="website" /><meta property="og:site_name" content="36 Football" /><meta property="og:title" content="${escapeHtml(title)}" /><meta property="og:description" content="${escapeHtml(description)}" /><meta property="og:url" content="${escapeHtml(canonicalUrl)}" /><meta property="og:image" content="${SHARE_IMAGE}" /><meta property="og:image:width" content="512" /><meta property="og:image:height" content="512" /><meta property="og:image:alt" content="36 Football helmet and wordmark" /><meta name="twitter:card" content="summary" /><meta name="twitter:title" content="${escapeHtml(title)}" /><meta name="twitter:description" content="${escapeHtml(description)}" /><meta name="twitter:image" content="${SHARE_IMAGE}" /></head><body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></body></html>`;
};

export const registerSharePreview = (app: { get: (path: string[], handler: (req: Request, res: Response, next: () => void) => void) => void }) => {
  app.get(["/", "/join"], (req, res, next) => {
    if (!isShareCrawler(req.get("user-agent"))) return next();
    res.status(200).set("Cache-Control", "public, max-age=300").type("html").send(shareCardHtml(req.path));
  });
};
