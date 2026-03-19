# browser-xp

Next.js front-end for booting the local `xp.img` disk in the browser with `v86`
and on-demand 2 MB disk chunks.

## What it does

- Boots `xp.img` in `v86` from a Next.js page.
- Serves the local disk through byte ranges with fixed 2 MB read alignment.
- Can boot from the public Cloudflare R2 `xp.img` object, or from a local copy.
- Vendors the `v86` runtime assets needed by the browser.

## Local disk setup

The app resolves the XP disk in this order:

1. `XP_IMAGE_URL=https://.../xp.img`
2. `XP_IMAGE_PATH=/absolute/path/to/your/xp.img`
3. `disk-images/xp.img` inside the repository
4. `../xp.img` next to the app folder
5. the default Cloudflare R2 object URL baked into the app

The legacy sibling lookup is still supported:

```bash
../xp.img
```

An example file is included at [`.env.example`](/Users/teoriket/Documents/aa/browser-xp/.env.example).

For Cloudflare R2, use the exact object URL for `xp.img`, not just the bucket root.
The app is configured with the current public object URL by default, and the remote
object must answer `HEAD` with `Content-Length` and `GET` with byte-range requests
so the app can keep serving `xp-START-END.img` as fixed 2 MB chunks.

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
- `/api/xp-image/xp-START-END.img`: optional explicit 2 MB chunk endpoint.

## Verification completed

This project was verified locally with:

- `npm run build`
- `npm run lint`
- production server checks against `/`, `/api/xp-meta`, and `/api/xp-image/...`
- headless Chromium loading the page, attaching `window.V86`, and requesting
  real chunk URLs such as `xp-0-2097152.img`

## Notes

- Cloudflare R2 is the preferred home for the large disk image instead of Git.
- The guest network stack is intentionally not configured in this pass.
- The app assumes the XP image has already been prepared for `v86` use.
- For Windows 2000/XP, the official `v86` docs call out one critical prep step:
  the guest must be changed from `ACPI Uniprocessor PC` to `Standard PC`.
  Without that conversion, Chromium commonly throws `Maximum call stack size exceeded`
  or `too much recursion` during startup even when the website and chunk streaming
  are working correctly.
