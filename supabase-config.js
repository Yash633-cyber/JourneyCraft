
const SUPABASE_URL = "https://fgraqkkouoefihbfbjkw.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_Q00s2FV9ujw65YIfFzDOYQ_Bv7jYSUV";

if (!window.supabase) {
    throw new Error("Supabase library did not load.");
}

window.supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
);

console.log("JourneyCraft: Supabase client initialized.");
