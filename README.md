# Money Counter (PWA)

A deliberately simple cash-counting app: a black screen with the seven euro banknotes
(€500, €200, €100, €50, €20, €10, €5). **Tap** a note to add it to your total, **hold** a
note to remove one (counts never go below zero). Your running session survives app
restarts; tapping **Finish** (bottom-right) shows the breakdown and, after **Ok**,
archives the session to an on-device encrypted history and starts a fresh session.
Open session history via the **clock-history button (top-left)**, by **swiping
from the left edge**, or via the thin edge handle. Tap a session to see its
numerical breakdown. **Long-press (or right-click)** a session in the list and
choose **Delete** to remove it.

It's a PWA (Progressive Web App) — the "modern equivalent" of an APK: installable
from the browser, launches full-screen from your home screen, and works fully offline.

## Run locally (desktop)

```
node server.js          # or: node server.js 3000
```

Open **http://localhost:8080** in Chrome. On desktop Chrome you can already try the
"install app" experience: click the install icon in the address bar.

## Install on your Android phone

Chrome only allows installing a PWA from a **secure origin** (HTTPS, or localhost).
Two practical routes:

### Route A — put it on any HTTPS static host (recommended)

Upload this folder to any static host — GitHub Pages, Netlify, Cloudflare Pages, etc.
(it's pure static files; there is no build step). Then on your phone:

1. Visit the HTTPS URL in Chrome.
2. Menu (⋮) → **"Install app"** (or "Add to Home screen").
3. Launch it from your home screen — full-screen, offline.

### Route B — same Wi-Fi, no hosting

1. Start `node server.js` and note the **Network** URL it prints (e.g. `http://192.168.1.20:8080`).
2. On the phone, open `chrome://flags/#unsafely-treat-insecure-origin-as-secure`,
   enable it for that URL, relaunch Chrome.
3. Visit the URL → menu (⋮) → **"Install app"**.

(This is a dev workaround; Route A is cleaner if you'll keep using the app.)

## How data is stored

- All data stays **on the device** in the browser profile — nothing is sent anywhere,
  and there is no server component.
- Session data (current session + full history) is stored as a single **JSON document,
  encrypted with AES-256-GCM** via the WebCrypto API. The key is generated on first run
  and held by the browser as a **non-extractable CryptoKey** in IndexedDB — page scripts
  can use it to encrypt/decrypt but can never read the raw key material. (On browsers
  that can't persist CryptoKeys, it falls back to a raw key in localStorage.)
- **Important:** data is per-device and per-browser-profile. Clearing site data for the
  app (or uninstalling and choosing "also remove data") deletes the session and history
  permanently. There is no sync and no backup.

## Files

| File | Purpose |
|---|---|
| `index.html` | App shell |
| `styles.css` | Black theme, note cards, drawer, modal |
| `app.js` | All logic: counting, gestures, encrypted persistence, history |
| `sw.js` | Service worker (offline support + installability) |
| `manifest.webmanifest` | PWA manifest |
| `icons/` | App icons (generated) |
| `server.js` | Tiny static server for local/LAN testing |
| `make-icons.js` | Regenerates the icons (`node make-icons.js`) |

## After changing app files

Bump the `CACHE` version in `sw.js` (e.g. `mc-v1` → `mc-v2`) so installed clients pick
up the new files on their next launch.
