// ============================================================
// notificationWebSocket.ts — ملاحظة مهمة
// ============================================================
// ⚠️  هذا الملف لا يُنشر كـ Edge Function في Supabase.
//
// السبب: Edge Functions stateless — لا تدعم WebSocket
// connections دائمة. الـ Map() في الكود الأصلي تُمسح
// مع كل طلب جديد → لم يكن يعمل أصلاً في الإنتاج.
//
// ✅  البديل الصحيح والمجاني: Supabase Realtime
// موجود تلقائياً في مشروعك — لا تحتاج أي كود إضافي.
//
// ── كيف تستخدمه في الـ Frontend ──────────────────────────
//
// import { createClient } from '@supabase/supabase-js'
// const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
//
// // استمع للإشعارات الخاصة بالمستخدم الحالي
// const channel = supabase
//   .channel('user-notifications')
//   .on(
//     'postgres_changes',
//     {
//       event:  'INSERT',
//       schema: 'public',
//       table:  'notifications',
//       filter: `user_id=eq.${currentUserId}`,
//     },
//     (payload) => {
//       console.log('إشعار جديد:', payload.new)
//       // أضف الإشعار لقائمة الإشعارات في الـ UI
//     }
//   )
//   .subscribe()
//
// // عند الخروج
// supabase.removeChannel(channel)
//
// ── تفعيل Realtime على جدول notifications ────────────────
// Dashboard → Database → Replication
// → اختر جدول notifications → فعّل INSERT
//
// ── ping/pong ─────────────────────────────────────────────
// Supabase Realtime يتولى heartbeat تلقائياً.
// لا تحتاج كود ping/pong.
//
// ── إرسال إشعار من Edge Function ─────────────────────────
// فقط أدرج صفاً في جدول notifications بـ service role:
//   await admin.from('notifications').insert({ user_id, ... })
// Realtime يوصله للـ Frontend فوراً.
// ============================================================

// هذا الملف توثيقي فقط — لا يُنشر.
export {};
