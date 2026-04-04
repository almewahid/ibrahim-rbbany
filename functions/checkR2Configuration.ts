// ============================================================
// checkR2Configuration.ts — نسخة Supabase
// ------------------------------------------------------------
// التغيير الوحيد من Base44:
//   1. base44.auth.me() → supabase.auth.getUser()
//   2. حُذفت رسالة "Using Base44 storage" — لم تعد ذات معنى
//
// باقي المنطق مطابق تماماً.
// ============================================================

import { serve }        from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { S3Client, ListBucketsCommand } from "npm:@aws-sdk/client-s3@3.554.0";

serve(async (req) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  // ── 1. Auth (replaces: base44.auth.me()) ──
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── 2. Check env vars (identical to Base44) ──
  const accessKeyId     = Deno.env.get("CLOUDFLARE_R2_ACCESS_KEY_ID");
  const secretKey       = Deno.env.get("CLOUDFLARE_R2_SECRET_ACCESS_KEY");
  const endpoint        = Deno.env.get("CLOUDFLARE_R2_ENDPOINT");
  const bucketName      = Deno.env.get("CLOUDFLARE_R2_BUCKET_NAME");

  const configured = !!(accessKeyId && secretKey && endpoint && bucketName);

  if (!configured) {
    return Response.json({
      configured: false,
      message:    "Cloudflare R2 credentials are not fully configured.",
      missing:    [
        !accessKeyId ? "CLOUDFLARE_R2_ACCESS_KEY_ID"     : null,
        !secretKey   ? "CLOUDFLARE_R2_SECRET_ACCESS_KEY" : null,
        !endpoint    ? "CLOUDFLARE_R2_ENDPOINT"           : null,
        !bucketName  ? "CLOUDFLARE_R2_BUCKET_NAME"        : null,
      ].filter(Boolean),
    });
  }

  // ── 3. Test actual connectivity with a lightweight request ──
  try {
    const s3 = new S3Client({
      region:   "auto",
      endpoint,
      credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretKey! },
      forcePathStyle: false,
    });

    await s3.send(new ListBucketsCommand({}));

    return Response.json({
      configured: true,
      message:    "Cloudflare R2 is configured and reachable.",
      details: {
        endpoint:   endpoint,
        bucket:     bucketName,
      },
    });
  } catch (connErr) {
    return Response.json({
      configured: true,           // credentials exist
      reachable:  false,          // but connection failed
      message:    "R2 credentials are set but connection test failed.",
      error:      connErr.message,
      details: {
        endpoint:   endpoint,
        bucket:     bucketName,
      },
    });
  }
});
