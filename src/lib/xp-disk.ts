import { createReadStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { DiskManifest } from "./xp-disk-types";

export const DISK_ALIAS = "xp.img";
export const DISK_CHUNK_SIZE = 2 * 1024 * 1024;

const CHUNK_FILE_PATTERN = /^xp-(\d+)-(\d+)\.img$/;

type DiskRequest =
  | { kind: "full" }
  | { endExclusive: number; kind: "chunk"; start: number };

type ParsedRange = { end: number; start: number };

function resolveDiskPath() {
  const configured = process.env.XP_IMAGE_PATH?.trim();

  if (configured) {
    return path.resolve(/*turbopackIgnore: true*/ configured);
  }

  return path.join(/*turbopackIgnore: true*/ process.cwd(), "..", DISK_ALIAS);
}

export async function getDiskManifest(): Promise<DiskManifest> {
  try {
    const disk = await stat(resolveDiskPath());

      return {
        alias: DISK_ALIAS,
        available: true,
        chunkSize: DISK_CHUNK_SIZE,
        lastModified: disk.mtime.toISOString(),
        size: disk.size,
        sourceLabel: process.env.XP_IMAGE_PATH
          ? "Configured local XP disk"
          : "Default sibling XP image",
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
        sourceLabel: process.env.XP_IMAGE_PATH
          ? "Configured local XP disk not found"
          : "Default sibling XP image not found",
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
  const handle = await open(resolveDiskPath(), "r");

  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

export function createDiskWebStream(start?: number, end?: number) {
  const fileStream =
    typeof start === "number" && typeof end === "number"
      ? createReadStream(resolveDiskPath(), { start, end })
      : createReadStream(resolveDiskPath());

  return Readable.toWeb(fileStream) as ReadableStream;
}
