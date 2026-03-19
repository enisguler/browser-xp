"use client";

import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import type { DiskManifest } from "@/lib/xp-disk-types";
import styles from "./xp-emulator.module.css";

type DownloadProgress = {
  file_name?: string;
  loaded?: number;
  total?: number;
};

type V86Options = {
  acpi?: boolean;
  autostart?: boolean;
  bios: { url: string };
  cpuid_level?: number;
  disable_keyboard?: boolean;
  disable_mouse?: boolean;
  hda: {
    async: boolean;
    fixed_chunk_size: number;
    size: number;
    url: string;
    use_parts: boolean;
  };
  memory_size: number;
  screen_container: HTMLElement;
  vga_bios: { url: string };
  vga_memory_size: number;
  wasm_path: string;
};

type V86Instance = {
  add_listener: (event: string, listener: (payload?: unknown) => void) => void;
  destroy: () => Promise<void>;
  is_running: () => boolean;
  restart: () => void;
  run: () => Promise<void>;
  screen_go_fullscreen: () => void;
  stop: () => Promise<void>;
};

declare global {
  interface Window {
    V86?: new (config: V86Options) => V86Instance;
  }
}

const V86_SCRIPT_SELECTOR = 'script[data-v86-runtime="true"]';

let runtimePromise: Promise<void> | null = null;

function loadV86Runtime() {
  if (typeof window === "undefined") {
    return Promise.resolve();
  }

  if (window.V86) {
    return Promise.resolve();
  }

  if (runtimePromise) {
    return runtimePromise;
  }

  runtimePromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(V86_SCRIPT_SELECTOR);

    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("The v86 runtime script failed to load.")),
        { once: true },
      );
      return;
    }

    const script = document.createElement("script");
    script.src = "/vendor/v86/libv86.js";
    script.async = true;
    script.dataset.v86Runtime = "true";
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error("The v86 runtime script failed to load.")),
      { once: true },
    );
    document.head.appendChild(script);
  });

  return runtimePromise;
}

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

function formatTimestamp(value: string | null) {
  if (!value) {
    return "Unavailable";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function getFileLabel(fileName?: string) {
  if (!fileName) {
    return "disk assets";
  }

  return fileName.split("/").at(-1) ?? fileName;
}

export default function XPEmulator({ manifest }: { manifest: DiskManifest }) {
  const screenContainerRef = useRef<HTMLDivElement | null>(null);
  const emulatorRef = useRef<V86Instance | null>(null);
  const [status, setStatus] = useState(
    manifest.available ? "Preparing the emulator runtime." : "Waiting for a local XP image.",
  );
  const [downloadStatus, setDownloadStatus] = useState(
    manifest.available
      ? "No chunks requested yet."
      : "Point XP_IMAGE_PATH at the disk, or keep ../xp.img next to the app folder.",
  );
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const facts = useMemo(
    () => [
      { label: "Disk", value: manifest.alias },
      { label: "Image size", value: formatBytes(manifest.size) },
      { label: "Chunk size", value: formatBytes(manifest.chunkSize) },
      { label: "Last seen", value: formatTimestamp(manifest.lastModified) },
    ],
    [manifest.alias, manifest.chunkSize, manifest.lastModified, manifest.size],
  );

  const pushLog = (message: string) => {
    const line = `${new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })}  ${message}`;

    startTransition(() => {
      setLogs((current) => [line, ...current].slice(0, 10));
    });
  };

  useEffect(() => {
    if (!manifest.available || !screenContainerRef.current) {
      return;
    }

    let cancelled = false;

    const boot = async () => {
      const screenContainer = screenContainerRef.current;

      if (!screenContainer) {
        return;
      }

      setError(null);
      setStatus("Loading the emulator runtime.");
      setDownloadStatus("Warming up v86 and checking local disk metadata.");
      pushLog(`Found ${manifest.alias} with ${manifest.totalChunks.toLocaleString()} fixed parts.`);
      pushLog("Loading vendored v86 runtime.");

      try {
        await loadV86Runtime();

        if (cancelled) {
          return;
        }

        if (!window.V86) {
          throw new Error("v86 did not register itself on the browser window.");
        }

        const Emulator = window.V86;
        const instance = new Emulator({
          wasm_path: "/vendor/v86/v86.wasm",
          memory_size: 256 * 1024 * 1024,
          vga_memory_size: 16 * 1024 * 1024,
          screen_container: screenContainer,
          bios: { url: "/vendor/v86/seabios.bin" },
          vga_bios: { url: "/vendor/v86/vgabios.bin" },
          acpi: false,
          cpuid_level: 6,
          disable_keyboard: false,
          disable_mouse: false,
          hda: {
            url: `/api/xp-image/${manifest.alias}`,
            async: true,
            size: manifest.size,
            use_parts: true,
            fixed_chunk_size: manifest.chunkSize,
          },
          autostart: true,
        });

        emulatorRef.current = instance;

        instance.add_listener("download-progress", (payload?: unknown) => {
          const progress = payload as DownloadProgress | undefined;
          const loaded = progress?.loaded ?? 0;
          const total = progress?.total ?? 0;

          if (total > 0) {
            const percent = Math.round((loaded / total) * 100);
            setDownloadStatus(`Downloading ${getFileLabel(progress?.file_name)} — ${percent}%`);
          } else {
            setDownloadStatus(`Requesting ${getFileLabel(progress?.file_name)}.`);
          }
        });

        instance.add_listener("download-error", () => {
          setError("The emulator hit a fetch problem while loading the runtime or disk parts.");
          setStatus("Chunk loading failed.");
          pushLog("A runtime or chunk download failed.");
        });

        instance.add_listener("emulator-ready", () => {
          setStatus("Runtime ready. Windows XP is taking over the disk.");
          setDownloadStatus("Streaming disk sectors on demand.");
          pushLog("v86 reported that the CPU and devices are ready.");
        });

        instance.add_listener("emulator-loaded", () => {
          pushLog("Core assets finished loading.");
        });

        instance.add_listener("emulator-started", () => {
          setRunning(true);
          setStatus("Windows XP is running in the browser.");
          setDownloadStatus("The screen is live. Click the display to capture input.");
          pushLog("Execution started.");
        });

        instance.add_listener("emulator-stopped", () => {
          setRunning(false);
          setStatus("The emulator is paused.");
          setDownloadStatus("Execution stopped. Resume it from the controls below.");
          pushLog("Execution stopped.");
        });
      } catch (bootError) {
        const message =
          bootError instanceof Error
            ? bootError.message
            : "The emulator failed to initialize.";

        setError(message);
        setStatus("The emulator could not be started.");
        setDownloadStatus("Check the server logs and the v86 assets.");
        pushLog(`Startup failed: ${message}`);
      }
    };

    void boot();

    return () => {
      cancelled = true;
      const instance = emulatorRef.current;
      emulatorRef.current = null;

      if (instance) {
        void instance.destroy().catch(() => undefined);
      }
    };
  }, [
    manifest.alias,
    manifest.available,
    manifest.chunkSize,
    manifest.size,
    manifest.totalChunks,
  ]);

  const toggleRunState = async () => {
    const instance = emulatorRef.current;

    if (!instance) {
      return;
    }

    if (instance.is_running()) {
      await instance.stop();
      return;
    }

    await instance.run();
  };

  const restart = () => {
    emulatorRef.current?.restart();
    pushLog("Restart requested.");
  };

  const goFullscreen = () => {
    emulatorRef.current?.screen_go_fullscreen();
    pushLog("Fullscreen requested.");
  };

  const focusScreen = () => {
    screenContainerRef.current?.focus();
    pushLog("Focused the emulator surface.");
  };

  return (
    <section className={styles.shell}>
      <header className={styles.topBar}>
        <div>
          <span className={styles.windowTag}>browser-xp</span>
          <h2>Windows XP on a chunked local disk endpoint</h2>
          <p>
            {status}
            {error ? ` ${error}` : ""}
          </p>
        </div>

        <div className={styles.badges}>
          <span className={running ? styles.badgeLive : styles.badgeIdle}>
            {running ? "Running" : "Idle"}
          </span>
          <span className={styles.badgeSoft}>{manifest.totalChunks.toLocaleString()} chunks</span>
        </div>
      </header>

      <div className={styles.contentGrid}>
        <div className={styles.stage}>
          {manifest.available ? (
            <div className={styles.screenFrame}>
              <div
                id="screen_container"
                ref={screenContainerRef}
                className={styles.screenContainer}
                tabIndex={0}
              >
                <div className={styles.screenText} />
                <canvas className={styles.screenCanvas} />
              </div>
            </div>
          ) : (
            <div className={styles.emptyState}>
              <h3>Local XP image not found</h3>
              <p>
                Keep <code>xp.img</code> one level above this app, or set{" "}
                <code>XP_IMAGE_PATH</code> before starting the Next.js server.
              </p>
            </div>
          )}

          <div className={styles.controls}>
            <button
              className={styles.primaryButton}
              type="button"
              onClick={() => void toggleRunState()}
              disabled={!manifest.available}
            >
              {running ? "Pause XP" : "Resume XP"}
            </button>
            <button
              className={styles.secondaryButton}
              type="button"
              onClick={restart}
              disabled={!manifest.available}
            >
              Restart
            </button>
            <button
              className={styles.secondaryButton}
              type="button"
              onClick={focusScreen}
              disabled={!manifest.available}
            >
              Focus Keyboard
            </button>
            <button
              className={styles.secondaryButton}
              type="button"
              onClick={goFullscreen}
              disabled={!manifest.available}
            >
              Fullscreen
            </button>
          </div>
        </div>

        <aside className={styles.telemetry}>
          <div className={styles.statusCard}>
            <span className={styles.statusLabel}>Chunk stream</span>
            <strong>{downloadStatus}</strong>
            <p>
              The browser asks for aligned 2 MB part files, and the Next.js route
              handler reads only those bytes from the local disk.
            </p>
          </div>

          <div className={styles.factList}>
            {facts.map((fact) => (
              <article key={fact.label} className={styles.factItem}>
                <span>{fact.label}</span>
                <strong>{fact.value}</strong>
              </article>
            ))}
          </div>

          <div className={styles.logPanel}>
            <div className={styles.logHeader}>
              <h3>Session log</h3>
              <span>Newest first</span>
            </div>
            <div className={styles.logList}>
              {logs.length > 0 ? (
                logs.map((entry) => (
                  <p key={entry} className={styles.logLine}>
                    {entry}
                  </p>
                ))
              ) : (
                <p className={styles.logPlaceholder}>
                  Runtime logs will appear here as soon as the boot sequence begins.
                </p>
              )}
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
