# Roadmap

- [x] 1. Employee intelligence: JIT integration policy, personas, team awareness
- [x] 2. Rankings: real sources (GSC → Google → estimate), labelled
- [x] 3. Business profiling from URL (onboarding, overview, brain)
- [x] 4. Google data section in reports (GSC/GA4 via Pipedream): surface real errors + connect CTA (gsc.functions.ts / ga4.functions.ts swallow errors → null)
- [x] 5. Chat images render as real images
- [x] 6. Siraj content calendar: plan → write+image → approve → one-click publish (/app/calendar) + learn from performance
- [x] 7. Morning briefing (Eva/أمل): briefings table created; build briefing.server.ts (approvals, today's posts, rank deltas, 3 daily ideas via dailyIdeas()) + card on /app + cron route /api/public/morning-briefing (bounded, idempotent per day)
- [x] 8. Autopilot & queue pages: show image thumbnails; queue link to calendar
- [x] Final: reports/briefing/queue verified; calendar UI verified without live session (external Supabase — no test login available)

## Round 2 (live E2E with real test account)
- [x] Cron URLs fixed (were pointing at old projects) + morning-briefing daily job (05:00–09:00 Cairo)
- [x] Siraj calendar: plan → 7 ideas → 7 posts w/ images → approve/publish gating verified
- [x] Dialect resolved from owner profile/country (no hardcoded Khaleeji); duplicate-day slot bug; UTC offset bug
- [x] Employee action panel limited to own tools
- [ ] Nour hardest-request E2E via chat (next)
- [ ] Publish so cron endpoints exist on production URL
- [x] Nour hardest-request E2E: fixed 3-min hang (GPT-5 90s timeout retried) → total AI budget, no timeout retries, fast model first for long outputs; long-form 6000 tokens; JSON salvage; research budget 22s
- [x] Briefing stats: Arabic zero rendered as a dot → western digits

## Round 3 (user request 12:01)
- [x] Chat: publish target follows the platform the user names (platforms.ts; no silent fallback; connect chip)
- [x] Facebook rejection: root cause = read-only scopes (pages_show_list only). Preflight scope check + Arabic explanation + sync warning; custom Meta OAuth client via secret PIPEDREAM_OAUTH_APP_FACEBOOK
- [x] Image director (imageBrief) anchored on user request + post text; enhance=false
- [x] Chat tools: SEO audit, rank check, calendar plan, daily ideas, performance learning run for real from chat
- [x] PublishPanel: manual edit, keep/remove generated image, upload image/video from device, multi-slot scheduling; message actions copy/share/download/edit/regenerate
- [ ] E2E browser test of new PublishPanel + Facebook relink with publish scopes (needs Meta OAuth client / user relink)
