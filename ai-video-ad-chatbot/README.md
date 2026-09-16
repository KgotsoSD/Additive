# AI Video Ad Chatbot — MVP skeleton

Prompt in, finished video out. This skeleton runs end-to-end **right now**
with mocked AI providers and a local FFmpeg renderer, so you can wire the
UI → API → pipeline → DB flow together before spending money on a generation
API.

Without an image-to-video provider, uploaded images are rendered as local
moving clips with a subtle Ken Burns push-in. This is genuine video motion,
but not AI-generated movement inside the product photo.

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
move through PENDING → SCRIPTING → GENERATING_IMAGES → ... → DONE, then a
locally rendered MP4 preview.

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

## Job queue and worker

Generation requests are now durable BullMQ jobs. The API creates the project,
queues its id, and returns immediately; the long-lived worker runs the
pipeline and records progress in Postgres. Run Redis plus these two processes:

```bash
npx prisma migrate deploy
npx prisma generate
npm run dev
# in another terminal
npm run worker
```

Set `REDIS_URL` and deploy the worker to a long-lived service (Railway, Fly,
or a VM), not a serverless request function. Jobs retry up to three times;
set `WORKER_CONCURRENCY=1` initially to control video-provider spend.
The API checks a worker heartbeat before it accepts a generation; if the
worker is offline it returns a clear 503 error instead of leaving the project
stuck at `PENDING`.

## Usage tracking

Each pipeline stage writes an append-only `UsageRecord` row, including its
provider, operation, quantity, unit, and USD cost. Mock/local operations are
recorded at $0. When wiring a real provider, pass its actual billed price into
the existing `onUsage` callback in `lib/pipeline/orchestrator.ts`; this keeps
project-level cost reporting independent of the provider you choose.

## Auth

`userId` is currently hardcoded to `"demo-user"` in the frontend. Swap in
Clerk, Auth.js, or Supabase Auth and pass the real signed-in user's id.

## What's NOT in this skeleton yet

- Real image/video/voice provider integrations (all mocked, see above)
- Generative image-to-video motion (local motion clips are included)
- Auth
- Any UI polish / storyboard preview / editing before final render
