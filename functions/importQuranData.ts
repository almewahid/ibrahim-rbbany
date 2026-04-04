// ============================================================
// importQuranData.ts — نسخة Supabase
// ------------------------------------------------------------
// التغييرات من Base44:
//   1. base44.auth.me() + user.role check  → supabase.auth.getUser() + profiles
//   2. base44.asServiceRole.entities.QuranVerse.filter  → supabase admin select
//   3. base44.asServiceRole.entities.QuranVerse.create  → supabase admin upsert
//
// تحسين مهم: استبدلنا الـ loop المتسلسل (6236 آية × طلب)
// بـ upsert دفعي (batch of 500) → أسرع بكثير.
// ============================================================

import { serve }        from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BATCH_SIZE = 500;

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

  console.log("Starting Quran data import...");

  // ── 2. Fetch Quran data (same API as Base44) ──
  const response = await fetch("https://api.alquran.cloud/v1/quran/quran-uthmani");

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }

  const apiData = await response.json();

  if (!apiData.data?.surahs) {
    return Response.json({ error: "Invalid Quran data structure", success: false }, { status: 500 });
  }

  // ── 3. Flatten all verses ──
  const allVerses: object[] = [];

  for (const surah of apiData.data.surahs) {
    for (const ayah of surah.ayahs) {
      allVerses.push({
        surah_number:      surah.number,
        surah_name:        surah.name,
        verse_number:      ayah.numberInSurah,
        verse_text:        ayah.text,
        verse_text_simple: ayah.text,
      });
    }
  }

  // ── 4. Batch upsert (replaces: loop of filter + create) ──
  // upsert on UNIQUE(surah_number, verse_number) → skips duplicates automatically
  let importedCount = 0;
  let errorCount    = 0;

  for (let i = 0; i < allVerses.length; i += BATCH_SIZE) {
    const batch = allVerses.slice(i, i + BATCH_SIZE);

    const { error: upsertErr } = await admin
      .from("quran_verses")
      .upsert(batch, { onConflict: "surah_number,verse_number", ignoreDuplicates: true });

    if (upsertErr) {
      console.error(`Batch ${i}-${i + BATCH_SIZE} error:`, upsertErr.message);
      errorCount += batch.length;
    } else {
      importedCount += batch.length;
      console.log(`Progress: ${importedCount}/${allVerses.length} verses`);
    }
  }

  const message = `✅ اكتمل الاستيراد!\n- تمت معالجة ${importedCount} آية\n- عدد الأخطاء: ${errorCount}`;

  return Response.json({
    success:         errorCount === 0,
    message,
    total_surahs:    apiData.data.surahs.length,
    total_verses:    allVerses.length,
    imported_verses: importedCount,
    errors:          errorCount,
  });
});
