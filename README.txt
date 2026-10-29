JourneyCraft - Full Frontend with Customer Voting

Files:
- index.html: Existing dashboard and journey mapping interface.
- style.css: Blue/white responsive styles, including public voting and analytics UI.
- script.js: Authentication, journey handling, public survey link generation, vote submission via Supabase RPC, and stage difficulty analytics.
- supabase-config.js: Supabase project URL and publishable browser key.

Setup:
1. Back up your current project folder.
2. Extract all four files into your JourneyCraft folder.
3. Confirm the required Supabase tables and submit_journey_stage_vote function exist.
4. Run with VS Code Live Server or publish through GitHub Pages.
5. Sign in, open a journey, click Create / Refresh Survey Link, then open the link in an incognito window to test a vote.

Important:
- Voting depends on the Supabase SQL setup and RLS/policies being correct.
- The project uses a Supabase publishable key in the frontend. Never put a service-role or secret key in frontend files.
- JavaScript syntax was checked, but live submissions must still be tested against the Supabase project.
