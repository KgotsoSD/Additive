# AI Video Ad Chatbot — MVP skeleton

Prompt in, finished video out. This skeleton runs end-to-end **right now**
with every AI call mocked (placeholder images/clips/audio), so you can wire
the UI → API → pipeline → DB flow together before spending money on any
generation API.

## Pipeline

```
prompt
  → 1-script.ts      (LLM: prompt -> structured storyboard/scenes + voiceover script)
  → 2-images.ts       (image-gen: one still per scene)
  → 3-video.ts        (video-gen: image -> short clip per scene)
  → 4-audio.ts        (voiceover + music)
  → 5-stitch.ts        (FFmpeg: concat clips, mix audio, output final.mp4)
```

Each step lives in its own file under `lib/pipeline/` and is called by
`lib/pipeline/orchestrator.ts`. Every step falls back to a mock
implementation if its API key env var isn't set, so the whole thing runs
with **zero API keys configured**.

## Setup

```bash
npm install
cp .env.example .env      # fill in DATABASE_URL at minimum
npx prisma migrate dev --name init
npm run dev
```

Open http://localhost:3000, type a prompt, hit Generate. You'll see status
move through PENDING → SCRIPTING → GENERATING_IMAGES → ... → DONE, and a
(broken, placeholder-URL) video element at the end — that's expected until
real storage/generation APIs are wired in.

## Wiring in real providers (in order of "do this first")

1. **LLM** (`lib/pipeline/1-script.ts`) — set `OPENAI_API_KEY`. Already
   fully implemented, just needs the key.
2. **Storage** (`lib/pipeline/5-stitch.ts` → `uploadToStorage`) — implement
   with `@aws-sdk/client-s3` against S3/R2/Azure Blob. Needed before real
   image/video/audio URLs mean anything.
3. **Image generation** (`lib/pipeline/2-images.ts`) — pick a provider,
   replace the mock branch, upload result to storage.
4. **Video generation** (`lib/pipeline/3-video.ts`) — pick a provider
   (image-to-video, not pure text-to-video, for consistency across
   scenes). These calls are typically async (submit job → poll/webhook) —
   budget real engineering time here, it's the trickiest integration.
5. **Voiceover/music** (`lib/pipeline/4-audio.ts`) — ElevenLabs for
   voiceover is the common choice; for music, a curated royalty-free
   library is simpler and cheaper than generating music.

## Important next step: real job queue

`app/api/generate/route.ts` currently fires the pipeline off in the same
process and lets the client poll for status. That's fine for local dev but
will die the moment you deploy to a serverless platform (Vercel functions
time out; the process won't survive to finish a multi-minute video job).
Before going further:

- Add **BullMQ + Redis** (already in `package.json`).
- `POST /api/generate` should only enqueue a job and return immediately.
- Run a separate long-lived worker process (e.g. on Railway/Fly/a small VM)
  that pulls jobs off the queue and calls `runPipeline`.
- Keep `GET /api/jobs/[id]` as-is — it just reads status from Postgres.

## Auth

`userId` is currently hardcoded to `"demo-user"` in the frontend. Swap in
Clerk, Auth.js, or Supabase Auth and pass the real signed-in user's id.

## What's NOT in this skeleton yet

- Real image/video/voice provider integrations (all mocked, see above)
- The BullMQ worker process itself (dependency is included, worker isn't written)
- Auth
- Any UI polish / storyboard preview / editing before final render
- Cost/usage tracking per generation (video-gen APIs are the expensive part)
