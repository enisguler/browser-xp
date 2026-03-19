import { createReadStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import path from "node:path";
import type { DiskManifest } from "./xp-disk-types";

export const DISK_ALIAS = "xp.img";
export const DISK_CHUNK_SIZE = 50 * 1024 * 1024;
const REMOTE_FETCH_TIMEOUT_MS = 15_000;
const DEFAULT_REMOTE_DISK_URL =
  "https://browser-xp-r2-proxy.enisleader.workers.dev/xp.img";

const CHUNK_FILE_PATTERN = /^xp-(\d+)-(\d+)\.img$/;
const REPO_DISK_DIRECTORY = "disk-images";

type DiskRequest =
  | { kind: "full" }
  | { endExclusive: number; kind: "chunk"; start: number };

type ParsedRange = { end: number; start: number };

type LocalDiskSource = {
  kind: "local";
  path: string;
  sourceLabel: string;
};

type RemoteDiskSource = {
  kind: "remote";
  sourceLabel: string;
  url: string;
};

type RemoteDiskMetadata = {
  lastModified: string | null;
  size: number;
};

function resolveConfiguredDiskPath() {
  const configured = process.env.XP_IMAGE_PATH?.trim();

  if (configured) {
    return path.resolve(/*turbopackIgnore: true*/ configured);
  }
}

function resolveConfiguredDiskUrl() {
  return process.env.XP_IMAGE_URL?.trim();
}

function resolveRepoDiskPath() {
  return path.join(
    /*turbopackIgnore: true*/ process.cwd(),
    REPO_DISK_DIRECTORY,
    DISK_ALIAS,
  );
}

function resolveSiblingDiskPath() {
  return path.join(/*turbopackIgnore: true*/ process.cwd(), "..", DISK_ALIAS);
}

async function resolveAvailableDisk() {
  const remoteUrl = resolveConfiguredDiskUrl();

  if (remoteUrl) {
    return {
      kind: "remote",
      url: remoteUrl,
      sourceLabel:
        remoteUrl === DEFAULT_REMOTE_DISK_URL
          ? "Default Cloudflare R2 XP disk"
          : "Configured remote XP disk",
    } satisfies RemoteDiskSource;
  }

  const configured = resolveConfiguredDiskPath();

  if (configured) {
    await stat(configured);

    return {
      kind: "local",
      path: configured,
      sourceLabel: "Configured local XP disk",
    } satisfies LocalDiskSource;
  }

  const candidates = [
    {
      kind: "local",
      path: resolveRepoDiskPath(),
      sourceLabel: "Bundled repository XP disk",
    },
    {
      kind: "local",
      path: resolveSiblingDiskPath(),
      sourceLabel: "Default sibling XP image",
    },
  ] satisfies LocalDiskSource[];

  for (const candidate of candidates) {
    try {
      await stat(candidate.path);
      return candidate;
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        continue;
      }

      throw error;
    }
  }

  return {
    kind: "remote",
    url: DEFAULT_REMOTE_DISK_URL,
    sourceLabel: "Default Cloudflare R2 XP disk",
  } satisfies RemoteDiskSource;
}

async function getRemoteDiskMetadata(url: string): Promise<RemoteDiskMetadata> {
  const response = await fetch(url, {
    method: "HEAD",
    cache: "no-store",
    signal: AbortSignal.timeout(REMOTE_FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Remote XP disk HEAD failed with ${response.status}.`);
  }

  const sizeHeader = response.headers.get("content-length");
  const size = Number(sizeHeader);

  if (!Number.isFinite(size) || size <= 0) {
    throw new Error("Remote XP disk did not return a valid Content-Length.");
  }

  return {
    size,
    lastModified: response.headers.get("last-modified"),
  };
}

export async function getDiskManifest(): Promise<DiskManifest> {
  try {
    const diskFile = await resolveAvailableDisk();

    if (diskFile.kind === "remote") {
      const disk = await getRemoteDiskMetadata(diskFile.url);

      return {
        alias: DISK_ALIAS,
        available: true,
        chunkSize: DISK_CHUNK_SIZE,
        lastModified: disk.lastModified,
        size: disk.size,
        sourceLabel: diskFile.sourceLabel,
        totalChunks: Math.ceil(disk.size / DISK_CHUNK_SIZE),
      };
    }

    const disk = await stat(diskFile.path);

      return {
        alias: DISK_ALIAS,
        available: true,
        chunkSize: DISK_CHUNK_SIZE,
        lastModified: disk.mtime.toISOString(),
        size: disk.size,
        sourceLabel: diskFile.sourceLabel,
        totalChunks: Math.ceil(disk.size / DISK_CHUNK_SIZE),
      };
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return {
        alias: DISK_ALIAS,
        available: false,
        chunkSize: DISK_CHUNK_SIZE,
        lastModified: null,
        size: 0,
        sourceLabel: process.env.XP_IMAGE_URL
          ? "Configured remote XP disk not reachable"
          : process.env.XP_IMAGE_PATH
          ? "Configured local XP disk not found"
          : "Bundled repository XP disk not found",
        totalChunks: 0,
      };
    }

    if (error instanceof Error) {
      return {
        alias: DISK_ALIAS,
        available: false,
        chunkSize: DISK_CHUNK_SIZE,
        lastModified: null,
        size: 0,
        sourceLabel: process.env.XP_IMAGE_URL
          ? "Configured remote XP disk not reachable"
          : "Default Cloudflare R2 XP disk not reachable",
        totalChunks: 0,
      };
    }

    throw error;
  }
}

export function parseDiskRequest(filename: string): DiskRequest | null {
  if (filename === DISK_ALIAS) {
    return { kind: "full" };
  }

  const match = CHUNK_FILE_PATTERN.exec(filename);

  if (!match) {
    return null;
  }

  const start = Number(match[1]);
  const endExclusive = Number(match[2]);

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(endExclusive) ||
    start < 0 ||
    endExclusive <= start ||
    start % DISK_CHUNK_SIZE !== 0 ||
    endExclusive - start !== DISK_CHUNK_SIZE
  ) {
    return null;
  }

  return { kind: "chunk", start, endExclusive };
}

export function parseRangeHeader(
  rangeHeader: string | null,
  totalSize: number,
): ParsedRange | null {
  if (!rangeHeader || !rangeHeader.startsWith("bytes=") || rangeHeader.includes(",")) {
    return null;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());

  if (!match) {
    return null;
  }

  const [, rawStart, rawEnd] = match;

  let start: number;
  let end: number;

  if (rawStart === "" && rawEnd === "") {
    return null;
  }

  if (rawStart === "") {
    const suffixLength = Number(rawEnd);

    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return null;
    }

    start = Math.max(totalSize - suffixLength, 0);
    end = totalSize - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === "" ? totalSize - 1 : Number(rawEnd);

    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      return null;
    }
  }

  if (start < 0 || end < start || start >= totalSize) {
    return null;
  }

  return { start, end: Math.min(end, totalSize - 1) };
}

export async function readDiskChunk(start: number, length: number) {
  const disk = await resolveAvailableDisk();

  if (disk.kind === "remote") {
    const response = await fetch(disk.url, {
      cache: "no-store",
      headers: {
        Range: `bytes=${start}-${start + length - 1}`,
      },
      signal: AbortSignal.timeout(REMOTE_FETCH_TIMEOUT_MS),
    });

    if (!response.ok && response.status !== 206) {
      throw new Error(`Remote XP disk range fetch failed with ${response.status}.`);
    }

    return Buffer.from(await response.arrayBuffer());
  }

  const handle = await open(disk.path, "r");

  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

export function createDiskWebStream(start?: number, end?: number) {
  const stream = new ReadableStream({
    async start(controller) {
      const disk = await resolveAvailableDisk();

      if (disk.kind === "remote") {
        const response = await fetch(disk.url, {
          cache: "no-store",
          headers:
            typeof start === "number" && typeof end === "number"
              ? { Range: `bytes=${start}-${end}` }
              : undefined,
          signal: AbortSignal.timeout(REMOTE_FETCH_TIMEOUT_MS),
        });

        if (!response.ok && response.status !== 206) {
          controller.error(
            new Error(`Remote XP disk stream fetch failed with ${response.status}.`),
          );
          return;
        }

        if (!response.body) {
          controller.error(new Error("Remote XP disk did not return a response body."));
          return;
        }

        const reader = response.body.getReader();

        try {
          while (true) {
            const { done, value } = await reader.read();

            if (done) {
              controller.close();
              break;
            }

            if (value) {
              controller.enqueue(value);
            }
          }
        } catch (error) {
          controller.error(error);
        }

        return;
      }

      const fileStream =
        typeof start === "number" && typeof end === "number"
          ? createReadStream(disk.path, { start, end })
          : createReadStream(disk.path);

      fileStream.on("data", (chunk) => {
        controller.enqueue(chunk);
      });
      fileStream.on("end", () => {
        controller.close();
      });
      fileStream.on("error", (error) => {
        controller.error(error);
      });
    },
    cancel() {
      return Promise.resolve();
    },
  });

  return stream as ReadableStream;
}
