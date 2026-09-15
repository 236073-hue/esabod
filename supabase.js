import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// This anon key is designed for browser use. The SQL schema's Row Level Security
// policies ensure every signed-in user can access only their own records.
const supabaseUrl = "https://bxgiwnekcwuromwaprhm.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ4Z2l3bmVrY3d1cm9td2FwcmhtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0ODM1MzksImV4cCI6MjEwNTA1OTUzOX0.9mPYrcnSBIogP19znjaIPS4f8F9oYYm0cBzEqQ2ljO4";

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export async function requireUser() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) window.location.replace("login.html");
  return user;
}
