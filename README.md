# browser-xp

Next.js front-end for booting the local `xp.img` disk in the browser with `v86`
and on-demand 2 MB disk chunks.

## What it does

- Boots `xp.img` in `v86` from a Next.js page.
- Serves aligned `xp-START-END.img` partfile requests from a local disk file.
- Keeps the repository clean by **not** committing the XP disk image itself.
- Vendors the `v86` runtime assets needed by the browser.

## Local disk setup

By default, the app looks for a sibling disk image:

```bash
../xp.img
```

You can override that with:

```bash
XP_IMAGE_PATH=/absolute/path/to/your/xp.img
```

An example file is included at [`.env.example`](/Users/teoriket/Documents/aa/browser-xp/.env.example).

## Run it

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Or build and run production:

```bash
npm run build
npm run start -- --hostname 127.0.0.1 --port 3000
```

Then open [http://127.0.0.1:3000](http://127.0.0.1:3000).

## Routes

- `/`: XP launcher UI and embedded emulator surface.
- `/api/xp-meta`: disk metadata used by the UI and health checks.
- `/api/xp-image/xp.img`: full disk endpoint with byte-range support.
- `/api/xp-image/xp-START-END.img`: fixed 2 MB partfile endpoint for `v86`.

## Verification completed

This project was verified locally with:

- `npm run build`
- `npm run lint`
- production server checks against `/`, `/api/xp-meta`, and `/api/xp-image/...`
- headless Chromium loading the page, attaching `window.V86`, and requesting
  real chunk URLs such as `xp-0-2097152.img`

## Notes

- The repository intentionally excludes the Windows XP disk image.
- The guest network stack is intentionally not configured in this pass.
- The app assumes the XP image has already been prepared for `v86` use.
