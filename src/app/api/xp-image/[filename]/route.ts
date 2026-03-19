import {
  createDiskWebStream,
  DISK_ALIAS,
  getDiskManifest,
  parseDiskRequest,
  parseRangeHeader,
  readDiskChunk,
} from "@/lib/xp-disk";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteParams = Promise<{ filename: string }>;

function buildBaseHeaders(cacheControl: string) {
  return new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": cacheControl,
    "Content-Type": "application/octet-stream",
    "Content-Disposition": `inline; filename="${DISK_ALIAS}"`,
  });
}

async function handleRequest(method: "GET" | "HEAD", filename: string, request: Request) {
  const descriptor = parseDiskRequest(filename);

  if (!descriptor) {
    return Response.json({ error: "Unknown XP disk asset." }, { status: 404 });
  }

  const manifest = await getDiskManifest();

  if (!manifest.available) {
    return Response.json(
      { error: "The local XP disk is not available on this server." },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }

  if (descriptor.kind === "chunk") {
    if (descriptor.endExclusive > manifest.size) {
      return new Response(null, { status: 416 });
    }

    const chunk = await readDiskChunk(
      descriptor.start,
      descriptor.endExclusive - descriptor.start,
    );
    const headers = buildBaseHeaders("public, max-age=31536000, immutable");

    headers.set("Content-Length", String(chunk.byteLength));

    if (method === "HEAD") {
      return new Response(null, { headers, status: 200 });
    }

    return new Response(chunk, { headers, status: 200 });
  }

  const range = parseRangeHeader(request.headers.get("range"), manifest.size);

  if (range) {
    const headers = buildBaseHeaders("no-store");
    const length = range.end - range.start + 1;

    headers.set("Content-Length", String(length));
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${manifest.size}`);

    if (method === "HEAD") {
      return new Response(null, { headers, status: 206 });
    }

    return new Response(createDiskWebStream(range.start, range.end), {
      headers,
      status: 206,
    });
  }

  const headers = buildBaseHeaders("no-store");
  headers.set("Content-Length", String(manifest.size));

  if (method === "HEAD") {
    return new Response(null, { headers, status: 200 });
  }

  return new Response(createDiskWebStream(), { headers, status: 200 });
}

export async function GET(
  request: Request,
  { params }: { params: RouteParams },
) {
  const { filename } = await params;
  return handleRequest("GET", filename, request);
}

export async function HEAD(
  request: Request,
  { params }: { params: RouteParams },
) {
  const { filename } = await params;
  return handleRequest("HEAD", filename, request);
}
