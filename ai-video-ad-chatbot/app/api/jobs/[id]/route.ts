import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const project = await prisma.project.findUnique({ where: { id: params.id } });

    if (!project) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    return NextResponse.json({
      id: project.id,
      status: project.status,
      finalVideoUrl: project.finalVideoUrl,
      errorMessage: project.errorMessage,
      script: project.script,
      platform: project.platform,
      style: project.style,
      durationSecs: project.durationSecs,
      productImages: project.productImages,
    });
  } catch (err) {
    console.error("[jobs]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load job" },
      { status: 500 }
    );
  }
}
