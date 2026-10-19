/* =========================================================
   SmartCare — shared Supabase configuration
   Used by: index.html, staff-login.html, staff.html

   The "publishable" key is designed to be public — it is safe in browser code
   ONLY because Row Level Security (see database/smartcare_setup.sql) decides
   what each user may read or change.

   NEVER put the "secret" / "service_role" key in any front-end file.
   ========================================================= */
window.SMARTCARE_CONFIG = {
  SUPABASE_URL: "https://poxftbzgcguzpdsjkbrs.supabase.co",
  SUPABASE_KEY: "sb_publishable_klfcdMI4YZ20UC4YNj465w_2Qxefr_J",
  QUEUE_WINDOW_HOURS: 24,   // queue / dashboard show patients registered in the last N hours (must match the SQL)
  AVG_MIN_PER_PATIENT: 5    // minutes used for "estimated time"
};
