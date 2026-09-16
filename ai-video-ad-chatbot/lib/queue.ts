import { Queue } from "bullmq";
import IORedis from "ioredis";

export const GENERATION_QUEUE = "video-generation";
export const WORKER_HEARTBEAT_KEY = `${GENERATION_QUEUE}:worker-heartbeat`;

export type GenerationJobData = { projectId: string };

function redisUrl() {
  // A local default makes startup predictable. The API rejects requests when
  // REDIS_URL is absent, so production cannot accidentally use this value.
  return process.env.REDIS_URL?.trim() || "redis://127.0.0.1:6379";
}

function createRedisConnection() {
  const connection = new IORedis(redisUrl(), { maxRetriesPerRequest: null });
  // ioredis emits `error` events rather than rejecting them. Always consume
  // those events so an unavailable local Redis does not become an unhandled
  // process error; requests still fail cleanly through the API health check.
  connection.on("error", (error) => console.error("[redis] connection error:", error.message));
  return connection;
}

/** A producer-only queue. The Worker lives in worker.ts, outside Next.js. */
export const generationQueue = new Queue<GenerationJobData>(GENERATION_QUEUE, {
  connection: createRedisConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 1_000 },
  },
});

export function queueConnection() {
  return createRedisConnection();
}

export function isQueueConfigured() {
  return Boolean(process.env.REDIS_URL?.trim());
}

/**
 * A queue accepting TCP connections is not enough: jobs would still wait
 * indefinitely if no worker consumes them. Workers refresh this key every
 * few seconds, and the API uses it as an admission check.
 */
export async function hasLiveWorker() {
  try {
    const connected = generationQueue.client.then((client) => client.get(WORKER_HEARTBEAT_KEY));
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 3_000));
    return Boolean(await Promise.race([connected, timeout]));
  } catch {
    return false;
  }
}
