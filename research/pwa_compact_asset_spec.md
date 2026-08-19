# 36 Football Compact PWA Asset Specification

## Purpose

This record distinguishes the **installed-app compact identity** from the full public-header lockup. It is the source specification for validating that the compact icon does not include the `FOOTBALL` wordmark.

| Surface | Asset identifier | Required composition | Wordmark rule |
|---|---|---|---|
| Compact PWA icon, 192 px | `36football-helmet-icon-192_6d7e3e68.png` | Centered dark football helmet with the orange-and-cream `36` mark, on a near-black square field | Must contain no text other than the helmet's `36` mark; no `FOOTBALL` wordmark or season line |
| Compact PWA icon, 512 px | `36football-helmet-icon-512_53e09209.png` | Same helmet-only artwork and crop as the 192 px icon, scaled for high-density installation surfaces | Must contain no text other than the helmet's `36` mark; no `FOOTBALL` wordmark or season line |
| Browser favicon and Apple touch icon | `36football-helmet-icon-192_6d7e3e68.png` | Uses the compact 192 px helmet-only asset | Must follow the compact-icon wordmark rule |
| Shared public header | `36football-helmet-wordmark-192_f71497b3.png` | Full approved helmet-and-wordmark lockup; paired with the visible `36 FOOTBALL` brand copy | Wordmark is permitted only on this full-lockup header surface |

> **Acceptance rule:** A compact installed-app surface is compliant only when its image presents the helmet and `36` mark without the `FOOTBALL` wordmark. The public header intentionally uses a distinct full-lockup asset.

## Binary Verification Record

On 2026-08-19, the live 512 px compact asset was saved directly from the public manifest target and inspected as a 512 × 512 RGBA PNG. It displays only the dark helmet and its `36` decal; no `FOOTBALL` wordmark or season line appears in the binary.

| Field | Verified value |
|---|---|
| 512 px live asset | `36football-helmet-icon-512_53e09209.png` |
| 512 px saved verification file | `/home/ubuntu/webdev-static-assets/36football-helmet-icon-512-live.png` |
| 512 px dimensions / SHA-256 | 512 × 512 px · `a6828386213071075eb1343783ceded082df0b5855228eb808cd8a7dc5419b4d` |
| 192 px live asset | `36football-helmet-icon-192_6d7e3e68.png` |
| 192 px saved verification file | `/home/ubuntu/webdev-static-assets/36football-helmet-icon-192-live.png` |
| 192 px dimensions / SHA-256 | 192 × 192 px · `008ff434ad20a5c1188381d953bd70fdd48d1bd8fa24076f9ac6b5d07a42e200` |
| Visual result | Both direct binary inspections show the helmet and `36` decal only; no `FOOTBALL` wordmark or season line |
