import XPEmulator from "@/components/xp-emulator";
import { getDiskManifest } from "@/lib/xp-disk";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

function formatBytes(bytes: number) {
  if (bytes === 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** exponent;

  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[exponent]}`;
}

export default async function Home() {
  const manifest = await getDiskManifest();

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <div className={styles.kicker}>Browser-hosted Windows XP</div>
            <h1>Boot the current XP disk in the browser with on-demand 2 MB chunks.</h1>
            <p className={styles.lead}>
              This site wraps your existing local <code>xp.img</code> in a Next.js
              frontend and exposes it to <code>v86</code> through a chunked disk
              endpoint. The guest network stack is intentionally left alone for
              now so we can focus on a clean, reliable browser boot path.
            </p>

            <div className={styles.factGrid}>
              <article className={styles.factCard}>
                <span>Disk status</span>
                <strong>{manifest.available ? "Ready" : "Missing"}</strong>
                <p>
                  {manifest.available
                    ? "The server can see the configured XP image."
                    : "Start the site on the machine that has the XP image mounted locally."}
                </p>
              </article>
              <article className={styles.factCard}>
                <span>Image size</span>
                <strong>{formatBytes(manifest.size)}</strong>
                <p>
                  Served as discrete 2 MB parts so the browser only pulls sectors
                  that XP actually touches while booting.
                </p>
              </article>
              <article className={styles.factCard}>
                <span>Chunk count</span>
                <strong>{manifest.totalChunks.toLocaleString()}</strong>
                <p>
                  v86 reads the disk lazily through HTTP byte ranges, and each read
                  is rounded to a fixed 2 MB boundary for predictable chunking.
                </p>
              </article>
            </div>
          </div>

          <aside className={styles.sidebar}>
            <div className={styles.sidebarPanel}>
              <h2>Boot profile</h2>
              <ul className={styles.sidebarList}>
                <li>Raw disk: <code>{manifest.alias}</code></li>
                <li>Chunk size: <code>{formatBytes(manifest.chunkSize)}</code></li>
                <li>Disk source: {manifest.sourceLabel}</li>
                <li>XP guest requirement: convert ACPI to Standard PC for v86 stability</li>
              </ul>
            </div>

            <div className={styles.sidebarPanel}>
              <h2>What this build does</h2>
              <p>
                It serves the XP disk from the local filesystem through Node-based
                route handlers, loads the emulator runtime from vendored assets,
                and keeps the repository free of your private disk images.
              </p>
            </div>
          </aside>
        </section>

        <section className={styles.workbench}>
          <XPEmulator manifest={manifest} />
        </section>
      </main>
    </div>
  );
}
