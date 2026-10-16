import { authorize, apiError } from "@/lib/server/session";
import { readFile } from "node:fs/promises";
import path from "node:path";
export async function GET(req: Request) {
  try {
    authorize(req);
    const kind = new URL(req.url).searchParams.get("kind");
    const filename =
      kind === "all"
        ? "../release/Kendaliku_MyControl_v3_All_In_One.json"
        : kind === "ai"
        ? "02-ai-worker.json"
        : kind === "followup"
          ? "04-followup.json"
          : kind === "inbound"
            ? "01-waha-inbound.json"
            : "03-outbound.json";
    const body = await readFile(
      path.join(process.cwd(), "workflows/production", filename),
      "utf8",
    );
    return new Response(body, {
      headers: {
        "content-type": "application/json",
        "content-disposition": `attachment; filename="${path.basename(filename)}"`,
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
