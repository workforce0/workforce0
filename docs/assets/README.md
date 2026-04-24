# docs/assets

Images referenced from the project root `README.md` and other documentation live here.

## Pending assets

| File | Status | Source |
|------|--------|--------|
| `logo.svg` | placeholder | Hand-written SVG (three concentric rounded squares, indigo) |
| `onboarding.png` | pending | Generate via Stitch — prompt at `docs/stitch-prompts/01-setup-wizard.md` |
| `integrations.png` | pending | Generate via Stitch — prompt at `docs/stitch-prompts/06-settings.md` |
| `approvals.png` | pending | Generate via Stitch — prompt at `docs/stitch-prompts/07-approval-queue.md` |
| `hero.png` | optional | Optional hero banner for top of README |

## Replacing the logo placeholder

The current `logo.svg` is a minimal placeholder (three concentric rounded squares in indigo `#4F46E5`). To replace with a final design:

1. Keep the filename `logo.svg` so existing references continue to work.
2. Use `viewBox="0 0 120 120"` (or update the `width`/`height` attributes in root `README.md`).
3. Stick to the brand palette: off-white `#FAFAF9`, charcoal `#18181B`, indigo accent `#4F46E5`.
4. No external fonts — convert text to paths so GitHub markdown renders it.
5. Keep file size under ~5 KB; strip editor metadata (`inkscape:*`, `sodipodi:*`).
6. Include `<title>Workforce0</title>` for screen readers.

## Preferred formats

- **SVG** — logos and vector marks (scales cleanly, small payload)
- **PNG** — UI screenshots and mockups (retina-sized, ~2x logical resolution)
