import { supabase } from '@/lib/supabase';

export const User = {
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
};

// Placeholder - هتبدله بعدين لما تعمل الجداول
export const Query = new Proxy({}, {
  get: () => () => Promise.resolve([])
});