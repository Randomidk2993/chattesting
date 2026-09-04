// ══════════════════════════════════════════
//  NEXUS CHAT — Supabase Configuration
//  Used ONLY for audio and video storage.
//  All other data stays in Firebase.
// ══════════════════════════════════════════

const SUPABASE_URL  = 'https://lwhsfwbsbdqxjzqzigiy.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx3aHNmd2JzYmRxeGp6cXppZ2l5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg0ODI5NjIsImV4cCI6MjEwNDA1ODk2Mn0.MAWwViE0pgHEcEusKR5t5Z_pbBPoJsb__sk2n9HaiNE'; // ← paste your anon/public key here

// Storage bucket names (create these in Supabase dashboard)
const SUPABASE_AUDIO_BUCKET = 'nexus-audio';
const SUPABASE_VIDEO_BUCKET = 'nexus-video';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
