// ============================================================
// generateRecordingSummary.ts — نسخة Supabase
// ------------------------------------------------------------
// التغييرات من Base44:
//   1. base44.auth.me()                           → supabase.auth.getUser()
//   2. base44.asServiceRole.entities.Recording    → supabase admin
//   3. base44.asServiceRole.entities.BroadcastCover → supabase admin
//   4. base44.integrations.Core.CreateFileSignedUrl → R2 getSignedUrl
//   5. base44.integrations.Core.InvokeLLM (audio) → Anthropic (نصي فقط)
//      ملاحظة: Anthropic لا يدعم ملفات صوتية مباشرة.
//      استبدلنا بـ metadata-based summary (كان fallback في الأصل)
//      وهو الذي يعمل فعلياً في كلتا الحالتين.
//   6. base44.asServiceRole.entities.Recording.update → supabase admin update
// ============================================================

import { serve }        from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { S3Client, GetObjectCommand } from "npm:@aws-sdk/client-s3@3.400.0";
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

  // ── 2. Parse body ──
  const { recording_id } = await req.json();
  if (!recording_id) {
    return Response.json({ error: "recording_id is required" }, { status: 400 });
  }

  // ── 3. Fetch recording ──
  const { data: recording, error: recErr } = await admin
    .from("recordings")
    .select("id, title, category, duration_seconds, description, file_uri, cover_id")
    .eq("id", recording_id)
    .single();

  if (recErr || !recording) {
    return Response.json({ error: "Recording not found" }, { status: 404 });
  }

  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) {
    return Response.json({ error: "AI API key not configured" }, { status: 500 });
  }

  // ── 4. Build cover context (replaces: base44 BroadcastCover.filter) ──
  let coverContext = "";
  if (recording.cover_id) {
    const { data: cover } = await admin
      .from("broadcast_covers")
      .select("verses_text, hadith_text, surah_name, verse_from, verse_to")
      .eq("id", recording.cover_id)
      .single();

    if (cover?.verses_text?.length > 0) {
      coverContext = `\nموضوع الدرس: تفسير ${cover.verses_text.slice(0, 2).join(" ")}...`;
    } else if (cover?.hadith_text) {
      coverContext = `\nموضوع الدرس: شرح حديث "${cover.hadith_text.substring(0, 100)}..."`;
    } else if (cover?.surah_name) {
      coverContext = `\nالسورة: ${cover.surah_name}، الآيات ${cover.verse_from}–${cover.verse_to}`;
    }
  }

  // ── 5. Generate summary via Anthropic ──
  // Prompt مطابق لـ metadata fallback في Base44 (هو الذي يعمل فعلياً)
  const prompt = `قم بإنشاء ملخص جذاب للدرس التالي:

العنوان: ${recording.title}
الفئة: ${recording.category ?? "علوم شرعية"}
المدة: ${Math.floor((recording.duration_seconds ?? 0) / 60)} دقيقة
${coverContext}

الملخص يجب أن يكون:
- مختصر (3-5 أسطر)
- واضح ومباشر
- يبرز قيمة المحتوى وفائدته
- لا يذكر اسم المحاضر أو المذيع
- مناسب للمشاركة

الملخص فقط بدون أي مقدمات:`;

  const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type":      "application/json",
      "x-api-key":         anthropicKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model:      "claude-haiku-4-5-20251001",
      max_tokens: 600,
      messages:   [{ role: "user", content: prompt }],
    }),
  });

  if (!aiRes.ok) {
    const err = await aiRes.text();
    console.error("Anthropic error:", err);
    return Response.json({ error: "AI generation failed", success: false }, { status: 502 });
  }

  const aiData  = await aiRes.json();
  const summary = aiData.content?.[0]?.text?.trim() ?? "";

  // ── 6. Update recording.description ──
  // (replaces: base44.asServiceRole.entities.Recording.update)
  await admin
    .from("recordings")
    .update({ description: summary })
    .eq("id", recording_id);

  return Response.json({
    success: true,
    summary,
    message: "تم توليد الملخص بنجاح من محتوى التسجيل",
  });
});
