import { authorize, apiError } from "@/lib/server/session";
import { readBlashUpload } from "@/lib/server/blash-import";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    authorize(request, true);
    const max = 4 * 1024 * 1024;
    if (Number(request.headers.get("content-length") || 0) > max + 65536)
      return Response.json({ok:false,error:"File maksimal 4 MB"},{status:413});
    const form = await request.formData();
    const value = form.get("file");
    if (!value || typeof value === "string")
      return Response.json({ok:false,error:"Pilih file Excel .xlsx atau CSV."},{status:400});
    const file = value as File;
    if (!file.size || file.size > max)
      return Response.json({ok:false,error:"Ukuran file harus 1 byte hingga 4 MB"},{status:413});
    const result = await readBlashUpload(file.name, new Uint8Array(await file.arrayBuffer()));
    return Response.json({ok:true,...result},{headers:{"Cache-Control":"no-store"}});
  } catch (error) {
    const message=error instanceof Error?error.message:"File tidak dapat dibaca";
    if(message==="UNAUTHORIZED"||message==="FORBIDDEN")return apiError(error);
    return Response.json({ok:false,error:message},{status:400});
  }
}
