// ============================================================
// getRecordingAnalytics.ts — نسخة Supabase
// ------------------------------------------------------------
// التغييرات من Base44:
//   1. base44.auth.me()                        → supabase.auth.getUser()
//   2. base44.asServiceRole.entities.Recording → supabase admin
//   3. base44.asServiceRole.entities.ListenerStats → supabase admin
//   4. recording.created_date                  → recording.created_at
//
// المنطق الحسابي (engagement metrics) لم يتغير شيء.
// ============================================================

import { serve }        from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  // (replaces: base44.asServiceRole.entities.Recording.filter)
  const { data: recording, error: recErr } = await admin
    .from("recordings")
    .select(`
      title, broadcaster_name, duration_seconds,
      recorded_at, created_at, views_count,
      peak_listeners, file_size_mb, broadcast_id
    `)
    .eq("id", recording_id)
    .single();

  if (recErr || !recording) {
    return Response.json({ error: "Recording not found" }, { status: 404 });
  }

  // ── 4. Fetch listener stats ──
  // (replaces: base44.asServiceRole.entities.ListenerStats.filter)
  const { data: listenerStats } = await admin
    .from("listener_stats")
    .select("timestamp, active_listeners, peak_listeners")
    .eq("broadcast_id", recording.broadcast_id)
    .order("timestamp", { ascending: true });

  const stats = listenerStats ?? [];

  // ── 5. Calculate engagement metrics (identical to Base44) ──
  const totalStats  = stats.length;
  const avgListeners = totalStats > 0
    ? stats.reduce((sum, s) => sum + (s.active_listeners ?? 0), 0) / totalStats
    : 0;

  const peakListeners = recording.peak_listeners ?? 0;

  // Peak listening hours
  const hourlyStats: Record<number, { count: number; listeners: number }> = {};
  stats.forEach((stat) => {
    if (stat.timestamp) {
      const hour = new Date(stat.timestamp).getHours();
      if (!hourlyStats[hour]) hourlyStats[hour] = { count: 0, listeners: 0 };
      hourlyStats[hour].count++;
      hourlyStats[hour].listeners += stat.active_listeners ?? 0;
    }
  });

  const peakHours = Object.entries(hourlyStats)
    .map(([hour, data]) => ({
      hour:         parseInt(hour),
      avgListeners: data.count > 0 ? data.listeners / data.count : 0,
    }))
    .sort((a, b) => b.avgListeners - a.avgListeners)
    .slice(0, 3);

  const engagementRate = peakListeners > 0
    ? parseFloat(((avgListeners / peakListeners) * 100).toFixed(1))
    : 0;

  // Days since recording
  // Note: Base44 used created_date → Supabase uses created_at
  const createdAt      = new Date(recording.recorded_at ?? recording.created_at);
  const daysAgo        = Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
  const viewsCount     = recording.views_count ?? 0;
  const avgViewsPerDay = daysAgo > 0
    ? parseFloat((viewsCount / daysAgo).toFixed(1))
    : viewsCount;

  return Response.json({
    success: true,
    analytics: {
      title:            recording.title,
      broadcaster_name: recording.broadcaster_name,
      duration_minutes: Math.floor((recording.duration_seconds ?? 0) / 60),
      recorded_at:      recording.recorded_at ?? recording.created_at,

      // Engagement metrics
      total_views:      viewsCount,
      peak_listeners:   peakListeners,
      avg_listeners:    Math.round(avgListeners),
      engagement_rate:  engagementRate,

      // Time-based analytics
      days_since_recording: daysAgo,
      avg_views_per_day:    avgViewsPerDay,
      peak_hours:           peakHours.map((h) => ({
        hour:         h.hour,
        time:         `${h.hour}:00`,
        avgListeners: Math.round(h.avgListeners),
      })),

      // File info
      file_size_mb: recording.file_size_mb ?? 0,

      // Listener engagement timeline
      engagement_timeline: stats.map((s) => ({
        timestamp:        s.timestamp,
        active_listeners: s.active_listeners ?? 0,
      })),
    },
  });
});
