import { authorize, apiError } from "@/lib/server/session";
import { dbConfig } from "@/lib/server/database";
import { createClient } from "@supabase/supabase-js";
export async function POST(req: Request) {
  try {
    authorize(req, true);
    const b = await req.json();
    const mediaTypes: Record<string,{extension:string;max:number}> = {
      "image/jpeg": {extension:".jpg",max:8*1024*1024},
      "image/png": {extension:".png",max:8*1024*1024},
      "image/webp": {extension:".webp",max:8*1024*1024},
      "video/mp4": {extension:".mp4",max:25*1024*1024},
    };
    const media = mediaTypes[b.type as string];
    if (!media || !Number.isInteger(b.size) || b.size<1 || b.size>media.max)
      return Response.json(
        {error:"Poster JPG/PNG/WebP maksimal 8 MB, video MP4 maksimal 25 MB"},
        {status:400},
      );
    const { url, key } = dbConfig();
    const s = createClient(url, key, { auth: { persistSession: false } });
    const object = crypto.randomUUID() + media.extension;
    const { data, error } = await s.storage
      .from("mycontrol-campaigns")
      .createSignedUploadUrl(object);
    if (error) throw new Error("Penyimpanan media belum siap: " + error.message);
    return Response.json({
      signedUrl: data.signedUrl,
      path: "storage://mycontrol-campaigns/" + object,
    });
  } catch (e) {
    return apiError(e);
  }
}
