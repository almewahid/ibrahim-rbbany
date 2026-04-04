// ============================================================
// Edge Function: upload-to-r2
// ------------------------------------------------------------
// نسخة Supabase — مطابقة للمنطق الأصلي في Base44
// الفرق الوحيد: استبدال base44.auth.me() بـ Supabase JWT
//
// Environment variables:
//   CLOUDFLARE_R2_ENDPOINT          (مثال: https://xxx.r2.cloudflarestorage.com)
//   CLOUDFLARE_R2_ACCESS_KEY_ID
//   CLOUDFLARE_R2_SECRET_ACCESS_KEY
//   CLOUDFLARE_R2_BUCKET_NAME
//   CLOUDFLARE_R2_PUBLIC_URL        (مثال: https://cdn.yourdomain.com)
//   SUPABASE_URL
//   SUPABASE_ANON_KEY
//
// Request: multipart/form-data
//   file:       File
//   fileName?:  string   (اختياري، يستخدم اسم الملف إذا لم يُحدد)
//   folder?:    string   (افتراضي: 'recordings')
//   recordingId?: string (اختياري — لتحديث recording.file_url تلقائياً)
//
// Response:
// {
//   success: true
//   file_key: string
//   public_url: string
//   file_size: number
// }
// ============================================================

import { serve }        from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  S3Client,
  PutObjectCommand,
} from "npm:@aws-sdk/client-s3@3.400.0";

serve(async (req) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  // ── 1. Authenticate via Supabase JWT ──
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

  // ── 2. Parse form data (same as Base44 version) ──
  const formData   = await req.formData();
  const file       = formData.get("file") as File | null;
  const fileName   = (formData.get("fileName") as string) || file?.name || "file";
  const folder     = (formData.get("folder") as string)   || "recordings";
  const recordingId = formData.get("recordingId") as string | null;

  if (!file) {
    return Response.json({ error: "No file provided" }, { status: 400 });
  }

  // ── 3. Validate: only broadcasters can upload ──
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || !["broadcaster", "admin"].includes(profile.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // ── 4. Initialize R2 client (identical to Base44) ──
  const s3Client = new S3Client({
    region:   "auto",
    endpoint: Deno.env.get("CLOUDFLARE_R2_ENDPOINT")!,
    credentials: {
      accessKeyId:     Deno.env.get("CLOUDFLARE_R2_ACCESS_KEY_ID")!,
      secretAccessKey: Deno.env.get("CLOUDFLARE_R2_SECRET_ACCESS_KEY")!,
    },
  });

  const bucketName = Deno.env.get("CLOUDFLARE_R2_BUCKET_NAME")!;
  const key        = `${folder}/${Date.now()}_${fileName}`;

  // ── 5. Upload to R2 (identical to Base44) ──
  const arrayBuffer = await file.arrayBuffer();
  const buffer      = new Uint8Array(arrayBuffer);

  const command = new PutObjectCommand({
    Bucket:      bucketName,
    Key:         key,
    Body:        buffer,
    ContentType: file.type,
  });

  await s3Client.send(command);

  // ── 6. Build public URL ──
  // Use custom CDN domain if set, otherwise fall back to R2 endpoint
  const baseUrl  = Deno.env.get("CLOUDFLARE_R2_PUBLIC_URL")
                ?? Deno.env.get("CLOUDFLARE_R2_ENDPOINT");
  const publicUrl = `${baseUrl}/${key}`;

  // ── 7. Optional: update recording.file_url in Supabase ──
  if (recordingId) {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    await supabaseAdmin
      .from("recordings")
      .update({
        file_url:     publicUrl,
        file_uri:     key,
        file_size_mb: parseFloat((file.size / (1024 * 1024)).toFixed(2)),
      })
      .eq("id", recordingId);
  }

  return Response.json({
    success:    true,
    file_key:   key,
    public_url: publicUrl,
    file_size:  file.size,
    message:    "تم رفع الملف بنجاح إلى Cloudflare R2",
  });
});
