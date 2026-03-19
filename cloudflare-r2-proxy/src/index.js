const OBJECT_KEY = "xp.img";

function applyCors(headers, origin) {
  headers.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Range, Content-Type");
  headers.set("Access-Control-Expose-Headers", "Accept-Ranges, Content-Length, Content-Range, Content-Type, ETag, Last-Modified");
  headers.set("Vary", "Origin");

  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
  } else {
    headers.set("Access-Control-Allow-Origin", "*");
  }
}

function buildOptionsResponse(request) {
  const headers = new Headers();
  applyCors(headers, request.headers.get("Origin"));
  headers.set("Access-Control-Max-Age", "3600");
  return new Response(null, { headers, status: 204 });
}

const worker = {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return buildOptionsResponse(request);
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: {
          Allow: "GET, HEAD, OPTIONS",
        },
      });
    }

    const url = new URL(request.url);

    if (url.pathname !== "/" && url.pathname !== `/${OBJECT_KEY}`) {
      return new Response("Not Found", { status: 404 });
    }

    if (request.method === "HEAD") {
      const object = await env.XP_BUCKET.head(OBJECT_KEY);

      if (object === null) {
        return new Response("Object Not Found", { status: 404 });
      }

      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set("Accept-Ranges", "bytes");
      headers.set("Content-Length", String(object.size));
      headers.set("ETag", object.httpEtag);
      headers.set("Cache-Control", "public, max-age=31536000, immutable");
      applyCors(headers, request.headers.get("Origin"));

      return new Response(null, { headers, status: 200 });
    }

    const object = await env.XP_BUCKET.get(OBJECT_KEY, {
      onlyIf: request.headers,
      range: request.headers,
    });

    if (object === null) {
      return new Response("Object Not Found", { status: 404 });
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("Accept-Ranges", "bytes");
    headers.set("ETag", object.httpEtag);
    headers.set("Cache-Control", "public, max-age=31536000, immutable");

    let status = "body" in object ? 200 : 412;

    if (
      "body" in object &&
      object.range &&
      typeof object.range.offset === "number" &&
      typeof object.range.length === "number"
    ) {
      const rangeEnd = object.range.offset + object.range.length - 1;
      headers.set("Content-Length", String(object.range.length));
      headers.set("Content-Range", `bytes ${object.range.offset}-${rangeEnd}/${object.size}`);
      if (object.range.length !== object.size || request.headers.has("range")) {
        status = 206;
      }
    } else if ("body" in object) {
      headers.set("Content-Length", String(object.size));
    }

    applyCors(headers, request.headers.get("Origin"));

    return new Response("body" in object ? object.body : undefined, {
      headers,
      status,
    });
  },
};

export default worker;
