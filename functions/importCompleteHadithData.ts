// ============================================================
// importCompleteHadithData.ts — نسخة Supabase
// ------------------------------------------------------------
// التغييرات من Base44:
//   1. base44.auth.me() + role check → supabase.auth.getUser() + profiles
//   2. base44.asServiceRole.entities.Hadith.filter/create → supabase admin upsert
//
// تحسين: batch upsert بدل loop متسلسل
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

  // ── 2. Hardcoded Al-Arba'een Al-Nawawiyyah (الأربعون النووية) ──
  // نفس البيانات التي كانت في Base44
  const hadiths = [
    { number: 1,  text: "إنما الأعمال بالنيات، وإنما لكل امرئ ما نوى...", reference: "متفق عليه", category: "النية" },
    { number: 2,  text: "الإسلام أن تشهد أن لا إله إلا الله وأن محمداً رسول الله...", reference: "رواه مسلم", category: "أركان الإسلام" },
    { number: 3,  text: "بني الإسلام على خمس: شهادة أن لا إله إلا الله وأن محمداً رسول الله...", reference: "متفق عليه", category: "أركان الإسلام" },
    { number: 4,  text: "إن أحدكم يجمع خلقه في بطن أمه أربعين يوماً نطفة...", reference: "متفق عليه", category: "القدر" },
    { number: 5,  text: "من أحدث في أمرنا هذا ما ليس منه فهو رد", reference: "متفق عليه", category: "البدعة" },
    { number: 6,  text: "إن الحلال بين وإن الحرام بين وبينهما أمور مشتبهات...", reference: "متفق عليه", category: "الورع" },
    { number: 7,  text: "الدين النصيحة. قلنا: لمن؟ قال: لله ولكتابه ولرسوله ولأئمة المسلمين وعامتهم", reference: "رواه مسلم", category: "النصيحة" },
    { number: 8,  text: "أمرت أن أقاتل الناس حتى يشهدوا أن لا إله إلا الله وأن محمداً رسول الله...", reference: "متفق عليه", category: "الإسلام" },
    { number: 9,  text: "ما نهيتكم عنه فاجتنبوه وما أمرتكم به فأتوا منه ما استطعتم...", reference: "متفق عليه", category: "الطاعة" },
    { number: 10, text: "إن الله طيب لا يقبل إلا طيباً...", reference: "رواه مسلم", category: "الحلال والحرام" },
    { number: 11, text: "دع ما يريبك إلى ما لا يريبك", reference: "رواه الترمذي والنسائي", category: "الورع" },
    { number: 12, text: "من حسن إسلام المرء تركه ما لا يعنيه", reference: "رواه الترمذي", category: "الأخلاق" },
    { number: 13, text: "لا يؤمن أحدكم حتى يحب لأخيه ما يحب لنفسه", reference: "متفق عليه", category: "الإيمان" },
    { number: 14, text: "لا يحل دم امرئ مسلم إلا بإحدى ثلاث...", reference: "متفق عليه", category: "الدماء" },
    { number: 15, text: "من كان يؤمن بالله واليوم الآخر فليقل خيراً أو ليصمت...", reference: "متفق عليه", category: "الأخلاق" },
    { number: 16, text: "لا تغضب", reference: "رواه البخاري", category: "الأخلاق" },
    { number: 17, text: "إن الله كتب الإحسان على كل شيء...", reference: "رواه مسلم", category: "الإحسان" },
    { number: 18, text: "اتق الله حيثما كنت وأتبع السيئة الحسنة تمحها...", reference: "رواه الترمذي", category: "التقوى" },
    { number: 19, text: "احفظ الله يحفظك...", reference: "رواه الترمذي", category: "التقوى" },
    { number: 20, text: "إن تستحي فاصنع ما شئت", reference: "رواه البخاري", category: "الحياء" },
    { number: 21, text: "قل آمنت بالله ثم استقم", reference: "رواه مسلم", category: "الاستقامة" },
    { number: 22, text: "الإسلام يهدم ما كان قبله والهجرة تهدم ما كان قبلها والحج يهدم ما كان قبله", reference: "رواه مسلم", category: "الإسلام" },
    { number: 23, text: "الطهور شطر الإيمان...", reference: "رواه مسلم", category: "الطهارة" },
    { number: 24, text: "يا عبادي إني حرمت الظلم على نفسي...", reference: "رواه مسلم", category: "الظلم" },
    { number: 25, text: "الصدقة تطفئ الخطيئة كما يطفئ الماء النار...", reference: "رواه الترمذي", category: "الصدقة" },
    { number: 26, text: "كل سلامى من الناس عليه صدقة كل يوم...", reference: "متفق عليه", category: "الصدقة" },
    { number: 27, text: "البر حسن الخلق والإثم ما حاك في صدرك وكرهت أن يطلع عليه الناس", reference: "رواه مسلم", category: "البر" },
    { number: 28, text: "عليك بالجماعة فإنما يأكل الذئب من الغنم القاصية", reference: "رواه أبو داود", category: "الجماعة" },
    { number: 29, text: "لو تعلمون ما أعلم لضحكتم قليلاً ولبكيتم كثيراً...", reference: "متفق عليه", category: "الخشية" },
    { number: 30, text: "إن الله فرض فرائض فلا تضيعوها...", reference: "رواه الدارقطني", category: "الفرائض" },
    { number: 31, text: "الزهد في الدنيا يريح القلب والبدن...", reference: "رواه ابن ماجه", category: "الزهد" },
    { number: 32, text: "لا ضرر ولا ضرار", reference: "رواه ابن ماجه", category: "الضرر" },
    { number: 33, text: "لو كان الدنيا تعدل عند الله جناح بعوضة...", reference: "رواه الترمذي", category: "الزهد" },
    { number: 34, text: "من رأى منكم منكراً فليغيره بيده...", reference: "رواه مسلم", category: "الأمر بالمعروف" },
    { number: 35, text: "لا تحاسدوا ولا تناجشوا ولا تباغضوا ولا تدابروا...", reference: "رواه مسلم", category: "الأخوة" },
    { number: 36, text: "من نفّس عن مؤمن كربة من كرب الدنيا نفّس الله عنه كربة من كرب يوم القيامة...", reference: "رواه مسلم", category: "التعاون" },
    { number: 37, text: "إن الله كتب الحسنات والسيئات ثم بين ذلك...", reference: "متفق عليه", category: "الحسنات" },
    { number: 38, text: "إن الله تجاوز لي عن أمتي الخطأ والنسيان...", reference: "رواه ابن ماجه", category: "العفو" },
    { number: 39, text: "إن الله لا يؤاخذكم باللغو في أيمانكم...", reference: "متفق عليه", category: "الأيمان" },
    { number: 40, text: "كن في الدنيا كأنك غريب أو عابر سبيل", reference: "رواه البخاري", category: "الزهد" },
    { number: 41, text: "لا يؤمن أحدكم حتى تكون هواه تبعاً لما جئت به", reference: "رواه النووي", category: "الإيمان" },
    { number: 42, text: "قال الله تعالى: من عادى لي ولياً فقد آذنته بالحرب...", reference: "رواه البخاري", category: "الأولياء" },
  ];

  // ── 3. Batch upsert ──
  const { error: upsertErr } = await admin
    .from("hadiths")
    .upsert(hadiths, { onConflict: "number", ignoreDuplicates: false });

  if (upsertErr) {
    console.error("Hadith upsert error:", upsertErr.message);
    return Response.json({
      success: false,
      error:   upsertErr.message,
      message: `❌ فشل الاستيراد: ${upsertErr.message}`,
    }, { status: 500 });
  }

  return Response.json({
    success:          true,
    imported_hadiths: hadiths.length,
    message:          `✅ تم استيراد ${hadiths.length} حديثاً من الأربعين النووية بنجاح`,
  });
});
