// ============================================================
// convertToVideo.ts — نسخة Supabase
// ------------------------------------------------------------
// ملاحظة: النسخة الأصلية كانت تحاول استدعاء 'https://api.ffmpeg.org'
// وهي خدمة غير موثوقة. النسخة الجديدة:
//   1. تُرجع audio_url + cover_url + ffmpeg_command للـ Frontend
//   2. أو تستخدم Cloudflare Images للتحويل إذا توفر
//
// التغييرات من Base44:
//   1. base44.auth.me()                          → supabase.auth.getUser()
//   2. base44.asServiceRole.entities.Recording   → supabase admin
//   3. base44.asServiceRole.entities.BroadcastCover → supabase admin
//   4. base44.integrations.Core.CreateFileSignedUrl → R2 signed URL
//   5. base44.integrations.Core.GenerateImage    → حُذف (غير موثوق)
//   6. base44.integrations.Core.UploadFile       → uploadToCloudflareR2
// ============================================================

import { serve }        from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  S3Client,
  GetObjectCommand,
} from "npm:@aws-sdk/client-s3@3.400.0";
import { getSignedUrl } from "npm:@aws-sdk/s3-request-presigner@3.400.0";

serve(async (req) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  // ── 1. Auth ──
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

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { recording_id } = await req.json();
  if (!recording_id) {
    return Response.json({ error: "recording_id is required" }, { status: 400 });
  }

  // ── 2. Fetch recording ──
  const { data: recording, error: recErr } = await admin
    .from("recordings")
    .select("id, title, file_url, file_uri, cover_id, broadcast_id, broadcaster_id")
    .eq("id", recording_id)
    .single();

  if (recErr || !recording) {
    return Response.json({ error: "Recording not found" }, { status: 404 });
  }

  // ── 3. Get audio URL ──
  // If file_url exists (already on R2) → use directly
  // If only file_uri (old Base44 storage) → generate R2 signed URL
  let audioUrl = recording.file_url;

  if (!audioUrl && recording.file_uri) {
    const s3 = new S3Client({
      region:   "auto",
      endpoint: Deno.env.get("CLOUDFLARE_R2_ENDPOINT")!,
      credentials: {
        accessKeyId:     Deno.env.get("CLOUDFLARE_R2_ACCESS_KEY_ID")!,
        secretAccessKey: Deno.env.get("CLOUDFLARE_R2_SECRET_ACCESS_KEY")!,
      },
    });

    audioUrl = await getSignedUrl(
      s3,
      new GetObjectCommand({
        Bucket: Deno.env.get("CLOUDFLARE_R2_BUCKET_NAME")!,
        Key:    recording.file_uri,
      }),
      { expiresIn: 3600 }
    );
  }

  if (!audioUrl) {
    return Response.json({ error: "Audio file not found" }, { status: 404 });
  }

  // ── 4. Get cover image URL ──
  let coverUrl: string | null = null;

  if (recording.cover_id) {
    const { data: cover } = await admin
      .from("broadcast_covers")
      .select("custom_image_url, summary_image_url")
      .eq("id", recording.cover_id)
      .single();

    coverUrl = cover?.custom_image_url ?? cover?.summary_image_url ?? null;
  }

  // ── 5. Return conversion instructions + FFmpeg command ──
  // (Same as the working Base44 .ts version — manual conversion)
  const ffmpegCommand = coverUrl
    ? `ffmpeg -loop 1 -i cover.jpg -i audio.webm -c:v libx264 -c:a aac -shortest output.mp4`
    : `ffmpeg -f lavfi -i color=c=black:s=1280x720 -i audio.webm -shortest -c:v libx264 -c:a aac output.mp4`;

  return Response.json({
    success: false,
    manual_conversion: {
      instructions: [
        "لتحويل التسجيل إلى فيديو، استخدم الأدوات التالية:",
        "1. قم بتحميل الملف الصوتي من الرابط أدناه",
        "2. قم بتحميل صورة الغلاف من الرابط أدناه (إن وجدت)",
        "3. استخدم FFmpeg أو أي محرر فيديو لدمج الصوت والصورة",
        "4. أو استخدم موقع مثل Kapwing.com للتحويل أونلاين",
      ],
      audio_url:      audioUrl,
      cover_url:      coverUrl,
      ffmpeg_command: ffmpegCommand,
    },
  });
});
