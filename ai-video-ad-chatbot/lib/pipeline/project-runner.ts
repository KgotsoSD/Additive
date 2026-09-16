import { JobStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { runPipeline } from "./orchestrator";
import type { AdPlatform, AdStyle, UsageEvent } from "./types";

/** Executes one persisted project and makes progress and spend durable. */
export async function runProject(projectId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new Error(`Project ${projectId} was not found`);
  if (project.status === JobStatus.DONE) return;

  try {
    const result = await runPipeline({
      prompt: project.prompt,
      projectId: project.id,
      durationSecs: project.durationSecs,
      platform: project.platform as AdPlatform,
      style: project.style as AdStyle,
      productImages: asStringArray(project.productImages),
      onProgress: async (step, data) => {
        await prisma.project.update({
          where: { id: project.id },
          data: {
            status: step as JobStatus,
            ...(data?.script ? { script: data.script as object } : {}),
          },
        });
      },
      onUsage: (usage) => recordUsage(project.id, usage),
    });

    await prisma.project.update({
      where: { id: project.id },
      data: {
        status: JobStatus.DONE,
        finalVideoUrl: result.finalVideoUrl,
        script: result.storyboard as object,
      },
    });
  } catch (error) {
    await prisma.project.update({
      where: { id: project.id },
      data: { status: JobStatus.FAILED, errorMessage: messageOf(error) },
    });
    throw error;
  }
}

async function recordUsage(projectId: string, usage: UsageEvent) {
  // Kept structural so the app can build before a developer has regenerated
  // Prisma locally; `prisma generate` after this migration supplies the model.
  const usageRecord = (prisma as unknown as {
    usageRecord: { create: (args: { data: Record<string, unknown> }) => Promise<unknown> };
  }).usageRecord;
  await usageRecord.create({
    data: {
      projectId,
      provider: usage.provider,
      operation: usage.operation,
      quantity: usage.quantity,
      unit: usage.unit,
      costUsd: usage.costUsd,
      metadata: usage.metadata as object | undefined,
    },
  });
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
