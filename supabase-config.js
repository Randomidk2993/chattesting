// ══════════════════════════════════════════
//  NEXUS CHAT — Supabase Configuration
//  Used ONLY for audio and video storage.
//  All other data stays in Firebase.
// ══════════════════════════════════════════

const SUPABASE_URL  = 'https://lwhsfwbsbdqxjzqzigiy.supabase.co';
const SUPABASE_ANON = 'YOUR_SUPABASE_ANON_KEY'; // ← paste your anon/public key here

// Storage bucket names (create these in Supabase dashboard)
const SUPABASE_AUDIO_BUCKET = 'nexus-audio';
const SUPABASE_VIDEO_BUCKET = 'nexus-video';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
