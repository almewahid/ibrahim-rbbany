// ============================================================
// uploadToYouTube.ts — نسخة Supabase
// ------------------------------------------------------------
// التغييرات من Base44:
//   1. base44.auth.me() + role    → supabase.auth.getUser() + profiles
//   2. base44.entities.Recording  → supabase.from("recordings")
//
// المنطق (إرجاع تعليمات يدوية) مطابق تماماً للأصل —
// YouTube API يحتاج OAuth2 ولا يمكن ربطه بـ API Key بسيط.
// ============================================================

import { serve }        from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  // ── 1. Auth: admin only ──
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

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role !== "admin") {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── 2. Parse body ──
  const { recording_id } = await req.json();
  if (!recording_id) {
    return Response.json({ error: "Recording ID is required" }, { status: 400 });
  }

  // ── 3. Fetch recording (replaces: base44.entities.Recording.filter) ──
  const { data: rec, error: recErr } = await supabase
    .from("recordings")
    .select("title, file_url, youtube_url")
    .eq("id", recording_id)
    .single();

  if (recErr || !rec) {
    return Response.json({ error: "Recording not found" }, { status: 404 });
  }

  // ── 4. Return upload instructions (identical to Base44) ──
  return Response.json({
    success: true,
    message: "لرفع التسجيل على يوتيوب، اتبع الخطوات التالية:",
    steps: [
      "1. افتح YouTube Studio",
      "2. انقر على 'إنشاء' → 'رفع فيديو'",
      `3. اختر الملف: ${rec.title}`,
      "4. أضف العنوان والوصف",
      "5. اختر الخصوصية (عام/غير مدرج/خاص)",
      "6. انشر الفيديو",
    ],
    recording_url:         rec.file_url,
    existing_youtube_url:  rec.youtube_url ?? null,
    download_instructions: "يمكنك تحميل الملف من صفحة التسجيلات ثم رفعه يدوياً",
  });
});
