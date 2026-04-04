// ============================================================
// getR2FileWithCors.ts — نسخة Supabase
// ------------------------------------------------------------
// التغيير الوحيد من Base44:
//   1. base44.auth.me()  → supabase.auth.getUser()
//   2. حُذف Fallback#4 (base44.integrations.Core.CreateFileSignedUrl)
//      لأنه لن يعمل بعد النقل — كل الملفات ستكون على R2
//
// باقي المنطق (3 cases) مطابق تماماً للأصل.
// ============================================================

import { serve }           from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient }    from "https://esm.sh/@supabase/supabase-js@2";
import { S3Client, GetObjectCommand } from "npm:@aws-sdk/client-s3@3.554.0";
import { getSignedUrl }    from "npm:@aws-sdk/s3-request-presigner@3.554.0";

const corsHeaders = {
  "Content-Type":                 "application/json",
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // ── 1. Auth (replaces: base44.auth.me()) ──
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: corsHeaders }
    );
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: corsHeaders }
    );
  }

  try {
    const { file_uri, file_url } = await req.json();

    const accessKeyId     = Deno.env.get("CLOUDFLARE_R2_ACCESS_KEY_ID");
    const secretAccessKey = Deno.env.get("CLOUDFLARE_R2_SECRET_ACCESS_KEY");
    const endpoint        = Deno.env.get("CLOUDFLARE_R2_ENDPOINT");
    const bucketName      = Deno.env.get("CLOUDFLARE_R2_BUCKET_NAME");
    const hasR2Creds      = accessKeyId && secretAccessKey && endpoint && bucketName;

    // ── Case 1: file_uri → R2 signed URL (الأولوية دائماً) ──
    if (file_uri && hasR2Creds) {
      try {
        const s3Client = new S3Client({
          region:   "auto",
          endpoint,
          credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! },
          forcePathStyle: false,
        });

        const key = file_uri
          .replace(`${bucketName}/`, "")
          .replace(/^\//, "");

        const signedUrl = await getSignedUrl(
          s3Client,
          new GetObjectCommand({ Bucket: bucketName, Key: key }),
          { expiresIn: 3600 }
        );

        return new Response(
          JSON.stringify({ url: signedUrl }),
          { status: 200, headers: corsHeaders }
        );
      } catch (r2Err) {
        console.error("R2 signed URL failed:", r2Err.message);
        // fall through to next case
      }
    }

    // ── Case 2: R2 direct URL → extract key → signed URL ──
    if (file_url && file_url.includes("r2.cloudflarestorage.com") && hasR2Creds) {
      try {
        const urlObj = new URL(file_url);
        const key    = urlObj.pathname
          .replace(/^\//, "")
          .replace(`${bucketName}/`, "");

        const s3Client = new S3Client({
          region:   "auto",
          endpoint,
          credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! },
          forcePathStyle: false,
        });

        const signedUrl = await getSignedUrl(
          s3Client,
          new GetObjectCommand({ Bucket: bucketName, Key: key }),
          { expiresIn: 3600 }
        );

        return new Response(
          JSON.stringify({ url: signedUrl }),
          { status: 200, headers: corsHeaders }
        );
      } catch (err) {
        console.error("Failed to sign R2 URL from file_url:", err.message);
      }
    }

    // ── Case 3: أي CDN عادي → أرجعه مباشرة ──
    if (file_url && file_url.startsWith("http") && !file_url.includes("r2.cloudflarestorage.com")) {
      return new Response(
        JSON.stringify({ url: file_url }),
        { status: 200, headers: corsHeaders }
      );
    }

    return new Response(
      JSON.stringify({ error: "No valid file URL or URI provided" }),
      { status: 400, headers: corsHeaders }
    );

  } catch (error) {
    console.error("Error getting file:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: corsHeaders }
    );
  }
});
