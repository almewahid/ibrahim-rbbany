// ============================================================
// generateQuizQuestions.ts — نسخة Supabase
// ------------------------------------------------------------
// التغييرات من Base44:
//   1. base44.auth.me()              → supabase.auth.getUser()
//   2. base44.entities.Recording     → supabase.from("recordings")
//   3. base44.integrations.Core.InvokeLLM → fetch Anthropic API مباشرة
//
// Environment variables:
//   SUPABASE_URL
//   SUPABASE_ANON_KEY
//   SUPABASE_SERVICE_ROLE_KEY
//   ANTHROPIC_API_KEY
// ============================================================

import { serve }        from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  // ── 1. Auth: admin only (same rule as Base44) ──
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

  // Check admin role (replaces: user.role !== 'admin')
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role !== "admin") {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── 2. Parse body ──
  const { recording_id, num_questions = 5 } = await req.json();

  if (!recording_id) {
    return Response.json({ error: "Recording ID is required" }, { status: 400 });
  }

  // ── 3. Fetch recording (replaces: base44.entities.Recording.filter) ──
  const { data: recording, error: recErr } = await supabase
    .from("recordings")
    .select("title, description, category, broadcaster_name")
    .eq("id", recording_id)
    .single();

  if (recErr || !recording) {
    return Response.json({ error: "Recording not found" }, { status: 404 });
  }

  // ── 4. Build prompt (identical to Base44) ──
  const prompt = `أنت خبير في إنشاء اختبارات تعليمية إسلامية. بناءً على المعلومات التالية عن الدرس:

العنوان: ${recording.title}
الوصف: ${recording.description ?? "غير متوفر"}
الفئة: ${recording.category ?? "علوم شرعية"}
المحاضر: ${recording.broadcaster_name}

قم بإنشاء ${num_questions} أسئلة اختيار من متعدد (4 خيارات لكل سؤال) تختبر فهم الطالب.
تأكد من أن الأسئلة متنوعة وواضحة ولها إجابة واحدة صحيحة فقط مع شرح مختصر.

أجب فقط بـ JSON بهذا الشكل بدون أي نص إضافي:
{
  "questions": [
    {
      "question": "نص السؤال",
      "options": ["الخيار 1", "الخيار 2", "الخيار 3", "الخيار 4"],
      "correct_answer": 0,
      "explanation": "شرح الإجابة"
    }
  ]
}`;

  // ── 5. Call Anthropic API (replaces: base44.integrations.Core.InvokeLLM) ──
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) {
    return Response.json({ error: "AI API key not configured" }, { status: 500 });
  }

  const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type":      "application/json",
      "x-api-key":         anthropicKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model:      "claude-haiku-4-5-20251001",
      max_tokens: 2000,
      messages:   [{ role: "user", content: prompt }],
    }),
  });

  if (!aiRes.ok) {
    const err = await aiRes.text();
    console.error("Anthropic error:", err);
    return Response.json({ error: "AI generation failed", success: false }, { status: 502 });
  }

  const aiData  = await aiRes.json();
  const rawText = aiData.content?.[0]?.text ?? "{}";

  // ── 6. Parse JSON response ──
  let questions = [];
  try {
    // Strip markdown code fences if present
    const clean = rawText.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);
    questions = parsed.questions ?? [];
  } catch (e) {
    console.error("Failed to parse AI response:", rawText);
    return Response.json({ error: "Invalid AI response format", success: false }, { status: 500 });
  }

  return Response.json({
    success:  true,
    questions,
    message:  `تم توليد ${questions.length} سؤال بنجاح`,
  });
});
