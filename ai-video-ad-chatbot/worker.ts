import { Worker } from "bullmq";
import {
  GENERATION_QUEUE,
  WORKER_HEARTBEAT_KEY,
  queueConnection,
  type GenerationJobData,
} from "./lib/queue";
import { runProject } from "./lib/pipeline/project-runner";

const heartbeat = queueConnection();
const publishHeartbeat = async () => {
  await heartbeat.set(WORKER_HEARTBEAT_KEY, "1", "EX", 30);
};

const worker = new Worker<GenerationJobData>(
  GENERATION_QUEUE,
  async (job) => {
    await runProject(job.data.projectId);
  },
  { connection: queueConnection(), concurrency: Number(process.env.WORKER_CONCURRENCY ?? 1) }
);

worker.on("completed", (job) => console.info(`[worker] completed ${job.id} (${job.data.projectId})`));
worker.on("failed", (job, error) => console.error(`[worker] failed ${job?.id}:`, error));
worker.on("ready", () => {
  void publishHeartbeat().catch((error) => console.error("[worker] heartbeat failed:", error));
});

const heartbeatTimer = setInterval(() => {
  void publishHeartbeat().catch((error) => console.error("[worker] heartbeat failed:", error));
}, 10_000);

async function shutdown(signal: string) {
  console.info(`[worker] ${signal}; closing after active work finishes`);
  clearInterval(heartbeatTimer);
  await worker.close();
  await heartbeat.quit();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

console.info(`[worker] listening on ${GENERATION_QUEUE}`);
