# Snag — Chrome Web Store listing assets

Everything needed to submit Snag to the Chrome Web Store, plus the
submission checklist.

## Contents

| File | Used for |
|---|---|
| `icon-128.png` | Store listing icon (128x128, also in `extension/icons/`) |
| `promo-tile.png` | Promo tile (440x280) — the image in the store directory |
| `screenshots/*.png` | 4 screenshots (1280x800). **Placeholders** — replace with real captures (see below) before submission |
| `description.md` | Short description (store listing) + full description (store page) |
| `privacy-policy.md` | Privacy policy draft — host it at a public URL (e.g. a simple static site or GitHub Pages) and link it in the listing |
| `permissions-justification.md` | Per-permission rationale for the "Permissions" disclosure questions |

Regenerate the placeholder graphics any time with:

```bash
python tools/make_icons.py
```

## Replace the placeholder screenshots before submitting

Capture real screenshots (1280x800, 2x preferred) of:

1. Field detection — sidebar on a real (anonymized) application form with detected questions
2. Answer generation — a draft answer card with the Approve & fill button
3. Subscription gate — the "Subscribe for $5/month" screen
4. Profile & memory — the profile fields and saved past answers

Strip any real personal data from the captures before uploading.

## Submission checklist (CWS dashboard)

- [ ] New item → "Chrome Extension"
- [ ] Name: Snag
- [ ] Short description: from `description.md` (128 chars)
- [ ] Full description: from `description.md`
- [ ] Category: Productivity
- [ ] Icon: `icon-128.png`
- [ ] Promo tile: `promo-tile.png`
- [ ] Screenshots: the 4 real captures (min 1280x800, max 10 MB each)
- [ ] Privacy policy URL: hosted `privacy-policy.md`
- [ ] **Monetization disclosure: YES** — paid subscription via Paddle
      (Merchant of Record); using Snag requires an active $5/month
      subscription (BYOK: users bring their own AI provider key/Ollama for
      answer generation itself)
- [ ] Permissions questions: answers in `permissions-justification.md`
- [ ] Upload the zip from the CI `release` job artifact
      (`snag-extension-v<version>.zip`, built on a `v*` tag) — or build
      locally: build `ui/` into `extension/sidebar/`, then
      `cd extension && npm run build && zip -r ../snag.zip . -x "node_modules/*" "src/*" "package*.json" "tsconfig.json" "vitest.config.ts"`
- [ ] The extension ID is **pinned** by the manifest `key` field (private
      key kept at `C:\Users\Sailesh\snag-extension-key.pem`, outside the
      repo): `jobacpbllhlmlidhnhoaobcdidjfknif` — the same ID in dev and in
      the store. Register it now, before submission:
      - Cognito callback URL:
        `chrome-extension://jobacpbllhlmlidhnhoaobcdidjfknif/oauth-callback`
      - Paddle checkout confirmation page:
        `chrome-extension://jobacpbllhlmlidhnhoaobcdidjfknif/checkout-done.html`
      - Deploy: `--parameters '{"ExtensionCallbackUrl": "chrome-extension://jobacpbllhlmlidhnhoaobcdidjfknif/oauth-callback"}'`
        (or set the `EXTENSION_CALLBACK_URL` GitHub secret to that value)
- [ ] Publish to "In review" → wait for review → release

## Versioning

Bump `extension/manifest.json` `version` before tagging; the CI release job
names the artifact `snag-extension-v<version>.zip`. Each CWS upload needs a
new version string.
