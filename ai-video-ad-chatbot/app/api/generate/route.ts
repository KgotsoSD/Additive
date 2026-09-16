import { NextRequest, NextResponse } from "next/server";
import { JobStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { generationQueue, hasLiveWorker, isQueueConfigured } from "@/lib/queue";
import type { AdPlatform, AdStyle } from "@/lib/pipeline/types";

const PLATFORMS = new Set(["tiktok", "instagram", "youtube"]);
const STYLES = new Set(["ugc", "cinematic", "product"]);

export async function POST(req: NextRequest) {
  try {
    if (!isQueueConfigured()) {
      return NextResponse.json(
        { error: "Generation queue is unavailable. Configure REDIS_URL and start npm run worker." },
        { status: 503 }
      );
    }
    if (!(await hasLiveWorker())) {
      return NextResponse.json(
        { error: "Generation worker is offline. Start `npm run worker`, wait for its listening message, then retry." },
        { status: 503 }
      );
    }
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

    await generationQueue.add("generate", { projectId: project.id }, { jobId: project.id });

    return NextResponse.json({ projectId: project.id, status: project.status });
  } catch (err) {
    console.error("[generate]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to start generation" },
      { status: 500 }
    );
  }
}
