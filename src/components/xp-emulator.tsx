"use client";

import { useEffect, useRef, useState } from "react";
import type { DiskManifest } from "@/lib/xp-disk-types";
import styles from "./xp-emulator.module.css";

type V86Options = {
  acpi?: boolean;
  autostart?: boolean;
  bios: { url: string };
  disable_jit?: boolean;
  disable_keyboard?: boolean;
  disable_mouse?: boolean;
  disable_speaker?: boolean;
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
};

declare global {
  interface Window {
    V86?: new (config: V86Options) => V86Instance;
  }
}

const V86_SCRIPT_SELECTOR = 'script[data-v86-runtime="true"]';

let runtimePromise: Promise<void> | null = null;

function loadV86Runtime() {
  if (typeof window === "undefined" || window.V86) {
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

function getBootErrorMessage(error: unknown) {
  const message =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : typeof error === "string"
        ? error
        : "The emulator failed to initialize.";

  const lowerMessage = message.toLowerCase();

  if (
    lowerMessage.includes("too much recursion") ||
    lowerMessage.includes("maximum call stack size exceeded")
  ) {
    return "XP still hit the known v86 recursion failure.";
  }

  return message;
}

export default function XPEmulator({ manifest }: { manifest: DiskManifest }) {
  const screenContainerRef = useRef<HTMLDivElement | null>(null);
  const emulatorRef = useRef<V86Instance | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!manifest.available || !screenContainerRef.current) {
      return;
    }

    let cancelled = false;

    const handleWindowError = (event: ErrorEvent) => {
      setError(getBootErrorMessage(event.error ?? event.message));
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      setError(getBootErrorMessage(event.reason));
    };

    window.addEventListener("error", handleWindowError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    const boot = async () => {
      const screenContainer = screenContainerRef.current;

      if (!screenContainer) {
        return;
      }

      setError(null);

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
          disable_jit: true,
          disable_keyboard: false,
          disable_mouse: false,
          disable_speaker: true,
          hda: {
            url: `/api/xp-image/${manifest.alias}`,
            async: true,
            size: manifest.size,
            use_parts: false,
            fixed_chunk_size: manifest.chunkSize,
          },
          autostart: true,
        });

        emulatorRef.current = instance;

        instance.add_listener("download-error", () => {
          setError("The emulator hit a disk or runtime download failure.");
        });

        instance.add_listener("emulator-started", () => {
          screenContainer.focus();
        });
      } catch (bootError) {
        setError(getBootErrorMessage(bootError));
      }
    };

    void boot();

    return () => {
      cancelled = true;
      window.removeEventListener("error", handleWindowError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
      const instance = emulatorRef.current;
      emulatorRef.current = null;

      if (instance) {
        void instance.destroy().catch(() => undefined);
      }
    };
  }, [manifest.alias, manifest.available, manifest.chunkSize, manifest.size]);

  if (!manifest.available) {
    return (
      <div className={styles.emptyState}>
        <div className={styles.messageCard}>
          <h1>XP image not found.</h1>
          <p>Keep `xp.img` next to the app or set `XP_IMAGE_PATH` before starting Next.js.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <div
        id="screen_container"
        ref={screenContainerRef}
        className={styles.screenContainer}
        tabIndex={0}
        aria-label="Windows XP emulator"
      >
        <div className={styles.screenText} />
        <canvas className={styles.screenCanvas} />
      </div>

      {error ? (
        <div className={styles.errorOverlay}>
          <div className={styles.messageCard}>
            <h1>XP could not start.</h1>
            <p>{error}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
