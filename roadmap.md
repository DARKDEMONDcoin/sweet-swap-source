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
- [ ] Chat: publish target must follow the platform the user names (LinkedIn ≠ Facebook) + connection check
- [ ] Facebook "المنصة رفضت الطلب" after connecting page — diagnose real Graph error and surface it
- [ ] Image prompts tied to the actual topic/reply (topic-anchored image_prompt)
- [ ] Real info for Nour/Siraj (live research evidence in chat)
- [ ] Chat can trigger section features (calendar plan, schedule, queue) from chat
- [ ] User freedom: edit text manually, toggle image, pick time/quantity, attach own image/video; message actions (copy/share/regenerate)
- [ ] Test everything E2E
