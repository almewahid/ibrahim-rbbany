import { supabase } from '@/lib/supabase';

// ============================
// Helper: بناء entity لأي جدول
// ============================
function createEntity(tableName) {
  return {
    // جلب كل السجلات
    list: async (orderBy = '-created_at', limit = null) => {
      let col = orderBy.replace('-', '');
      let asc = !orderBy.startsWith('-');
      // دعم created_date كبديل
      if (col === 'created_date') col = 'created_at';
      let query = supabase.from(tableName).select('*').order(col, { ascending: asc });
      if (limit) query = query.limit(limit);
      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },

    // جلب بفلتر
    filter: async (filters = {}, orderBy = null, limit = null) => {
      let query = supabase.from(tableName).select('*');
      for (const [key, value] of Object.entries(filters)) {
        if (value === null) query = query.is(key, null);
        else query = query.eq(key, value);
      }
      if (orderBy) {
        let col = orderBy.replace('-', '');
        let asc = !orderBy.startsWith('-');
        if (col === 'created_date') col = 'created_at';
        query = query.order(col, { ascending: asc });
      }
      if (limit) query = query.limit(limit);
      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },

    // جلب سجل واحد بالـ id
    get: async (id) => {
      const { data, error } = await supabase.from(tableName).select('*').eq('id', id).single();
      if (error) throw error;
      return data;
    },

    // إنشاء سجل جديد
    create: async (dataObj) => {
      const { data, error } = await supabase.from(tableName).insert([dataObj]).select().single();
      if (error) throw error;
      return data;
    },

    // تعديل سجل
    update: async (id, dataObj) => {
      const { data, error } = await supabase.from(tableName).update(dataObj).eq('id', id).select().single();
      if (error) throw error;
      return data;
    },

    // حذف سجل
    delete: async (id) => {
      const { error } = await supabase.from(tableName).delete().eq('id', id);
      if (error) throw error;
      return { success: true };
    },
  };
}

// ============================
// base44 الرئيسي
// ============================
export const base44 = {

  // ============================
  // auth
  // ============================
  auth: {
    me: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
      return profile ? { ...user, ...profile } : { ...user, role: 'user' };
    },

    updateMe: async (updates) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('غير مسجل الدخول');
      const { data, error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', user.id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },

    logout: async () => {
      await supabase.auth.signOut();
      window.location.href = '/';
    },

    redirectToLogin: () => {
      window.location.href = '/login';
    },
  },

  // ============================
  // entities - كل الجداول
  // ============================
  entities: {
    Broadcast:        createEntity('broadcasts'),
    BroadcastCover:   createEntity('broadcast_covers'),
    BroadcastMarker:  createEntity('broadcast_markers'),
    BroadcastSignal:  createEntity('broadcast_signals'),
    ChatMessage:      createEntity('chat_messages'),
    Comment:          createEntity('comments'),
    ContentLink:      createEntity('content_links'),
    DirectMessage:    createEntity('direct_messages'),
    Follow:           createEntity('follows'),
    Hadith:           createEntity('hadiths'),
    Like:             createEntity('likes'),
    ListenerStats:    createEntity('listener_stats'),
    Listener:         createEntity('listeners'),
    LiveQuestion:     createEntity('live_questions'),
    MorningAdhkar:    createEntity('morning_adhkar'),
    Notification:     createEntity('notifications'),
    Profile:          createEntity('profiles'),
    User:             createEntity('profiles'), // alias
    QuizAttempt:      createEntity('quiz_attempts'),
    Quiz:             createEntity('quizzes'),
    QuranVerse:       createEntity('quran_verses'),
    Rating:           createEntity('ratings'),
    Recording:        createEntity('recordings'),
    Series:           createEntity('series'),
    UserMarker:       createEntity('user_markers'),
    VideoChapter:     createEntity('video_chapters'),
  },

  // ============================
  // functions - Supabase Edge Functions
  // ============================
  functions: {
    invoke: async (functionName, payload = {}) => {
      const { data, error } = await supabase.functions.invoke(functionName, {
        body: payload,
      });
      if (error) throw error;
      return data;
    },
  },

  // ============================
  // integrations
  // ============================
  integrations: {
    Core: {
      UploadFile: async ({ file }) => {
        const fileName = `public/${Date.now()}_${file.name}`;
        const { data, error } = await supabase.storage
          .from('uploads')
          .upload(fileName, file);
        if (error) throw error;
        const { data: urlData } = supabase.storage.from('uploads').getPublicUrl(fileName);
        return { url: urlData.publicUrl };
      },

      UploadPrivateFile: async ({ file }) => {
        const fileName = `private/${Date.now()}_${file.name}`;
        const { data, error } = await supabase.storage
          .from('uploads')
          .upload(fileName, file);
        if (error) throw error;
        return { file_id: data.path, path: data.path };
      },

      CreateFileSignedUrl: async ({ file_id, expires_in = 3600 }) => {
        const { data, error } = await supabase.storage
          .from('uploads')
          .createSignedUrl(file_id, expires_in);
        if (error) throw error;
        return { signed_url: data.signedUrl };
      },

      InvokeLLM: () => Promise.resolve(''),
      SendEmail: () => Promise.resolve({}),
      SendSMS: () => Promise.resolve({}),
      GenerateImage: () => Promise.resolve({ url: '' }),
      ExtractDataFromUploadedFile: () => Promise.resolve({}),
    },
  },
};