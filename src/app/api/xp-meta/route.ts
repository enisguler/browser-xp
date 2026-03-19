import { getDiskManifest } from "@/lib/xp-disk";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const manifest = await getDiskManifest();

  return Response.json(manifest, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
