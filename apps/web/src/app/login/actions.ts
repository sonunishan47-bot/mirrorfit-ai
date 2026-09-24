'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';

import { createSupabaseServerClient } from '@/lib/supabase/server-client';

const credentialsSchema = z.object({
  email: z.email().max(320),
  password: z.string().min(1).max(200),
});

export async function signIn(formData: FormData): Promise<void> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });

  // One message for a malformed email, an unknown account and a wrong
  // password alike. Distinguishing them tells an attacker which addresses are
  // real staff, which is the first step of a targeted attempt.
  if (!parsed.success) {
    redirect('/login?error=1');
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    redirect('/login?error=1');
  }

  redirect('/displays');
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect('/login');
}
