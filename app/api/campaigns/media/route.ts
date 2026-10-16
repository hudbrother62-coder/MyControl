import { authorize, apiError } from "@/lib/server/session";
import { dbConfig } from "@/lib/server/database";
import { createClient } from "@supabase/supabase-js";
export async function POST(req: Request) {
  try {
    authorize(req, true);
    const b = await req.json();
    if (
      b.type !== "video/mp4" ||
      !Number.isFinite(b.size) ||
      b.size < 1 ||
      b.size > 25 * 1024 * 1024
    )
      return Response.json(
        { error: "Pilih video MP4 maksimal 25 MB" },
        { status: 400 },
      );
    const { url, key } = dbConfig();
    const s = createClient(url, key, { auth: { persistSession: false } });
    const object = crypto.randomUUID() + ".mp4";
    const { data, error } = await s.storage
      .from("mycontrol-campaigns")
      .createSignedUploadUrl(object);
    if (error) throw new Error("Penyimpanan video belum siap");
    return Response.json({
      signedUrl: data.signedUrl,
      path: "storage://mycontrol-campaigns/" + object,
    });
  } catch (e) {
    return apiError(e);
  }
}
