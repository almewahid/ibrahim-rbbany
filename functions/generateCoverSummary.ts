// ============================================================
// Edge Function: generate-cover-summary
// ------------------------------------------------------------
// Generates an AI summary of the previous lesson to populate
// broadcast_covers.previous_summary.
//
// Called from the frontend (broadcaster dashboard) when
// preparing a new broadcast cover.
//
// Request body:
// {
//   cover_id:    string   (UUID of the broadcast_cover row)
//   youtube_url: string   (optional — YouTube URL of previous lesson)
//   context:     string   (optional — brief notes from broadcaster)
// }
//
// Environment variables:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   ANTHROPIC_API_KEY   — or OPENAI_API_KEY if you prefer GPT
// ============================================================

import { serve }        from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Auth: must be a logged-in broadcaster
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Verify the caller is the broadcaster who owns this cover
  const supabaseUser = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: authErr } = await supabaseUser.auth.getUser();
  if (authErr || !user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { cover_id, youtube_url, context } = await req.json();

  if (!cover_id) {
    return new Response(
      JSON.stringify({ error: "cover_id is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Fetch the cover + its broadcast to verify ownership
  const { data: cover, error: coverErr } = await supabase
    .from("broadcast_covers")
    .select(`
      *,
      broadcast:broadcasts(
        title, description, broadcaster_id,
        series:series(title, description)
      )
    `)
    .eq("id", cover_id)
    .single();

  if (coverErr || !cover) {
    return new Response(
      JSON.stringify({ error: "Cover not found" }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }

  if (cover.broadcast.broadcaster_id !== user.id) {
    return new Response("Forbidden", { status: 403 });
  }

  // Build the AI prompt
  const coverType    = cover.template_type;
  const lectureTitle = cover.fixed_title ?? cover.broadcast.title;
  const seriesTitle  = cover.broadcast.series?.title ?? "";
  const surahInfo    = cover.surah_name
    ? `سورة ${cover.surah_name} — الآيات ${cover.verse_from} إلى ${cover.verse_to}`
    : "";

  const prompt = `أنت مساعد متخصص في تلخيص الدروس العلمية الإسلامية.
  
المطلوب: اكتب ملخصاً للدرس السابق يُعرض في بداية الدرس الجديد.
الملخص يجب أن يكون:
- باللغة العربية الفصحى المبسطة
- من 3 إلى 5 نقاط رئيسية
- مناسب للعرض على الشاشة في بداية الدرس
- لا يتجاوز 150 كلمة

معلومات الدرس:
- نوع الدرس: ${coverType}
- عنوان السلسلة: ${seriesTitle}
- عنوان الدرس: ${lectureTitle}
${surahInfo ? `- النطاق القرآني: ${surahInfo}` : ""}
${context ? `- ملاحظات المحاضر عن الدرس السابق: ${context}` : ""}
${youtube_url ? `- رابط الدرس السابق: ${youtube_url}` : ""}

أجب فقط بالملخص دون أي مقدمة أو خاتمة.`;

  // Call Claude API (Anthropic)
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");

  if (!anthropicKey) {
    return new Response(
      JSON.stringify({ error: "AI API key not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const aiResponse = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type":         "application/json",
      "x-api-key":            anthropicKey,
      "anthropic-version":    "2023-06-01",
    },
    body: JSON.stringify({
      model:      "claude-haiku-4-5-20251001",
      max_tokens: 400,
      messages:   [{ role: "user", content: prompt }],
    }),
  });

  if (!aiResponse.ok) {
    const err = await aiResponse.text();
    console.error("Anthropic API error:", err);
    return new Response(
      JSON.stringify({ error: "AI generation failed" }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }

  const aiData = await aiResponse.json();
  const summary = aiData.content?.[0]?.text ?? "";

  // Save summary back to the cover
  const { error: updateErr } = await supabase
    .from("broadcast_covers")
    .update({
      previous_summary: summary,
      youtube_url:      youtube_url ?? cover.youtube_url,
    })
    .eq("id", cover_id);

  if (updateErr) {
    console.error("Failed to update cover:", updateErr);
    return new Response(
      JSON.stringify({ error: "Failed to save summary" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({ success: true, summary }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
