import { supabase } from '@/lib/supabase';

export const base44 = {
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
    logout: async () => {
      await supabase.auth.signOut();
      window.location.href = '/';
    }
  },
  entities: {
    Query: new Proxy({}, {
      get: () => () => Promise.resolve([])
    })
  },
  integrations: {
    Core: {
      InvokeLLM: () => Promise.resolve(''),
      SendEmail: () => Promise.resolve({}),
      SendSMS: () => Promise.resolve({}),
      UploadFile: () => Promise.resolve({ url: '' }),
      GenerateImage: () => Promise.resolve({ url: '' }),
      ExtractDataFromUploadedFile: () => Promise.resolve({}),
    }
  }
};