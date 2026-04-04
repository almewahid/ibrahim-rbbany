// ============================================================
// generateQuiz.ts — نسخة Supabase
// ------------------------------------------------------------
// التغييرات من Base44:
//   1. base44.auth.me() + role             → supabase + profiles
//   2. base44.entities.Recording.filter    → supabase.from("recordings")
//   3. base44.entities.Broadcast.filter    → supabase.from("broadcasts")
//   4. base44.integrations.Core.InvokeLLM  → Anthropic API
//   5. base44.asServiceRole.entities.Quiz.create       → supabase insert
//   6. base44.asServiceRole.entities.QuizQuestion      → حُذف
//      ملاحظة: في مخطط Supabase الأسئلة مخزنة كـ JSONB
//      داخل جدول quizzes مباشرة (حقل questions) —
//      لا يوجد جدول QuizQuestion منفصل.
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

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // ── 2. Parse body ──
  const {
    recording_id,
    broadcast_id,
    series_id,
    num_questions = 10,
    difficulty    = "متوسط",
  } = await req.json();

  // ── 3. Fetch content for context (replaces: base44.entities.X.filter) ──
  let content = "";
  let title   = "";

  if (recording_id) {
    const { data: rec } = await admin
      .from("recordings")
      .select("title, description")
      .eq("id", recording_id)
      .single();
    if (rec) {
      title   = rec.title;
      content = `عنوان: ${rec.title}\nوصف: ${rec.description ?? ""}`;
    }
  } else if (broadcast_id) {
    const { data: bc } = await admin
      .from("broadcasts")
      .select("title, description")
      .eq("id", broadcast_id)
      .single();
    if (bc) {
      title   = bc.title;
      content = `عنوان: ${bc.title}\nوصف: ${bc.description ?? ""}`;
    }
  }

  if (!content) {
    return Response.json({ error: "recording_id or broadcast_id is required" }, { status: 400 });
  }

  // ── 4. Call Anthropic (replaces: base44.integrations.Core.InvokeLLM) ──
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) {
    return Response.json({ error: "AI API key not configured" }, { status: 500 });
  }

  const difficultyMap: Record<string, string> = {
    "سهل":   "أسئلة سهلة ومباشرة",
    "متوسط": "أسئلة متوسطة الصعوبة تتطلب فهماً جيداً",
    "صعب":   "أسئلة صعبة تتطلب تحليلاً عميقاً",
  };

  const prompt = `أنت معلم متخصص في العلوم الشرعية. قم بإنشاء ${num_questions} أسئلة ${difficultyMap[difficulty] ?? "متوسطة"} بناءً على المحتوى التالي:

${content}

متطلبات الأسئلة:
- كل سؤال يجب أن يكون واضحاً ومحدداً
- أسئلة اختيار من متعدد (4 خيارات)
- خيار واحد صحيح فقط
- أضف شرحاً مختصراً للإجابة الصحيحة
- يجب أن تكون الأسئلة متنوعة (حفظ، فهم، تطبيق)

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

  const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type":      "application/json",
      "x-api-key":         anthropicKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model:      "claude-haiku-4-5-20251001",
      max_tokens: 3000,
      messages:   [{ role: "user", content: prompt }],
    }),
  });

  if (!aiRes.ok) {
    console.error("Anthropic error:", await aiRes.text());
    return Response.json({ error: "AI generation failed", success: false }, { status: 502 });
  }

  const aiData  = await aiRes.json();
  const rawText = aiData.content?.[0]?.text ?? "{}";

  let questions = [];
  try {
    const clean  = rawText.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);
    questions    = parsed.questions ?? [];
  } catch (e) {
    console.error("Failed to parse AI response:", rawText);
    return Response.json({ error: "Invalid AI response", success: false }, { status: 500 });
  }

  // ── 5. Save quiz to Supabase ──
  // الأسئلة تُخزن كـ JSONB في حقل questions (من phase2 SQL)
  // لا يوجد جدول QuizQuestion منفصل في مخططنا
  const { data: quiz, error: quizErr } = await admin
    .from("quizzes")
    .insert({
      title:        `اختبار: ${title}`,
      description:  `اختبار تم توليده تلقائياً للمحاضرة: ${title}`,
      recording_id: recording_id ?? null,
      broadcast_id: broadcast_id ?? null,
      series_id:    series_id    ?? null,
      questions,                          // JSONB array
      passing_score: 70,
      is_active:     true,
      created_by:    user.id,
    })
    .select("id")
    .single();

  if (quizErr || !quiz) {
    console.error("Failed to create quiz:", quizErr);
    return Response.json({ error: "Failed to save quiz", success: false }, { status: 500 });
  }

  return Response.json({
    success:  true,
    quiz_id:  quiz.id,
    message:  `تم توليد ${questions.length} سؤال بنجاح`,
  });
});
