import { NextRequest, NextResponse } from "next/server";
import { PrismaClient, JobStatus } from "@prisma/client";
import { runPipeline } from "@/lib/pipeline/orchestrator";
import type { AdPlatform, AdStyle } from "@/lib/pipeline/types";

const prisma = new PrismaClient();

const PLATFORMS = new Set(["tiktok", "instagram", "youtube"]);
const STYLES = new Set(["ugc", "cinematic", "product"]);

export async function POST(req: NextRequest) {
  try {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const {
      prompt,
      userId,
      durationSecs = 30,
      platform = "instagram",
      style = "ugc",
      productImages = [],
    } = body as {
      prompt: string;
      userId: string;
      durationSecs?: number;
      platform?: AdPlatform;
      style?: AdStyle;
      productImages?: string[];
    };

    if (!prompt || !userId) {
      return NextResponse.json({ error: "prompt and userId are required" }, { status: 400 });
    }

    const safePlatform = PLATFORMS.has(platform) ? platform : "instagram";
    const safeStyle = STYLES.has(style) ? style : "ugc";
    const images = Array.isArray(productImages)
      ? productImages.filter((u) => typeof u === "string").slice(0, 8)
      : [];

    await prisma.user.upsert({
      where: { id: userId },
      update: {},
      create: { id: userId, email: `${userId}@example.com` },
    });

    const project = await prisma.project.create({
      data: {
        prompt,
        userId,
        durationSecs: Number(durationSecs) || 30,
        platform: safePlatform,
        style: safeStyle,
        productImages: images,
        aspectRatio: "9:16",
        status: JobStatus.PENDING,
      },
    });

    // Fire-and-forget pipeline; never let this reject the HTTP response
    void runPipeline({
      prompt,
      projectId: project.id,
      durationSecs: Number(durationSecs) || 30,
      platform: safePlatform as AdPlatform,
      style: safeStyle as AdStyle,
      productImages: images,
      onProgress: async (step, data) => {
        const current = await prisma.project.findUnique({
          where: { id: project.id },
          select: { status: true },
        });
        if (current?.status === JobStatus.DONE || current?.status === JobStatus.FAILED) {
          return;
        }
        await prisma.project.update({
          where: { id: project.id },
          data: {
            status: step as JobStatus,
            ...(data?.script ? { script: data.script as object } : {}),
          },
        });
      },
    })
      .then(async (result) => {
        await prisma.project.update({
          where: { id: project.id },
          data: {
            status: JobStatus.DONE,
            finalVideoUrl: result.finalVideoUrl,
            script: result.storyboard as object,
          },
        });
      })
      .catch(async (err) => {
        console.error("[pipeline]", err);
        await prisma.project.update({
          where: { id: project.id },
          data: { status: JobStatus.FAILED, errorMessage: String(err?.message ?? err) },
        });
      });

    return NextResponse.json({ projectId: project.id, status: project.status });
  } catch (err) {
    console.error("[generate]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to start generation" },
      { status: 500 }
    );
  }
}
