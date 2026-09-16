import { spawn } from "child_process";
import { writeFile, mkdtemp, mkdir, copyFile, access } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import type { GeneratedScene } from "./types";
import type { AudioAssets } from "./4-audio";

const COLORS = ["0x0f766e", "0x0b5a54", "0x1a1d27", "0x134e4a", "0x115e59", "0x042f2e"];
// Preview resolution — much faster than 1080p for local mock stitch
const W = 720;
const H = 1280;

/**
 * Fast local preview stitch:
 * - Fit full photo (pad, no blur/crop zoom)
 * - Encode clips in parallel
 * - 720x1280 @ 24fps ultrafast
 * - Mix music with stream copy for video
 */
export async function stitchFinalVideo(
  scenes: GeneratedScene[],
  audio: AudioAssets,
  projectId: string
): Promise<string> {
  const sorted = [...scenes].sort((a, b) => a.order - b.order);
  const workDir = await mkdtemp(path.join(tmpdir(), "avc-"));
  const uploadDir = path.join(process.cwd(), "public", "uploads");
  await mkdir(uploadDir, { recursive: true });

  // Cap scene hold time so long briefs don't make stitch crawl
  const clipPaths = await Promise.all(
    sorted.map(async (scene, i) => {
      const imagePath = await resolveImageToFile(
        scene.imageUrl,
        path.join(workDir, `still-${i}`),
        i
      );
      const clipPath = path.join(workDir, `clip-${i}.mp4`);
      const duration = Math.min(3.5, Math.max(1.5, Number(scene.durationSecs) || 2.5));
      await imageToClip(imagePath, clipPath, duration);
      return clipPath;
    })
  );

  const concatListPath = path.join(workDir, "concat.txt");
  await writeFile(
    concatListPath,
    clipPaths.map((p) => `file '${escapeConcatPath(p)}'`).join("\n"),
    "utf8"
  );

  const silentVideoPath = path.join(workDir, "silent.mp4");
  // Same codec params on every clip → concat can stream-copy
  await runFfmpeg([
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatListPath,
    "-c",
    "copy",
    "-an",
    "-movflags",
    "+faststart",
    silentVideoPath,
  ]);

  const fileName = `${projectId}-final.mp4`;
  const publicPath = path.join(uploadDir, fileName);
  const musicPath = await resolveLocalMedia(audio.musicUrl);

  if (musicPath) {
    const mixedPath = path.join(workDir, "mixed.mp4");
    await runFfmpeg([
      "-y",
      "-i",
      silentVideoPath,
      "-i",
      musicPath,
      "-filter_complex",
      "[1:a]volume=0.32,afade=t=in:st=0:d=0.4[a]",
      "-map",
      "0:v",
      "-map",
      "[a]",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-shortest",
      "-movflags",
      "+faststart",
      mixedPath,
    ]);
    await copyFile(mixedPath, publicPath);
  } else {
    await copyFile(silentVideoPath, publicPath);
  }

  return `/uploads/${fileName}?t=${Date.now()}`;
}

function escapeConcatPath(p: string) {
  return p.replace(/\\/g, "/").replace(/'/g, "'\\''");
}

function isRemote(url: string) {
  return /^https?:\/\//i.test(url);
}

async function resolveLocalMedia(url: string | undefined): Promise<string | null> {
  if (!url || url.startsWith("solid://") || /example-cdn|example\.com/i.test(url)) {
    return null;
  }
  if (!isRemote(url)) {
    const local = path.join(process.cwd(), "public", url.split("?")[0].replace(/^\//, ""));
    try {
      await access(local);
      return local;
    } catch {
      return null;
    }
  }
  return null;
}

async function makeSolidStill(dest: string, index: number) {
  const color = COLORS[index % COLORS.length];
  await runFfmpeg([
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=${color}:s=${W}x${H}:d=1`,
    "-frames:v",
    "1",
    dest,
  ]);
}

async function resolveImageToFile(url: string, destBase: string, index: number): Promise<string> {
  if (url.startsWith("solid://")) {
    const dest = `${destBase}.png`;
    await makeSolidStill(dest, index);
    return dest;
  }

  if (!isRemote(url)) {
    const clean = url.split("?")[0].replace(/^\//, "");
    const local = path.join(process.cwd(), "public", clean);
    try {
      await access(local);
      return local;
    } catch {
      const dest = `${destBase}.png`;
      await makeSolidStill(dest, index);
      return dest;
    }
  }

  if (/example-cdn\.com|your-bucket\.example\.com|placehold\.co/i.test(url)) {
    const dest = `${destBase}.png`;
    await makeSolidStill(dest, index);
    return dest;
  }

  try {
    const res = await fetch(url);
    const contentType = res.headers.get("content-type") ?? "";
    if (!res.ok || contentType.includes("svg") || !contentType.startsWith("image/")) {
      const dest = `${destBase}.png`;
      await makeSolidStill(dest, index);
      return dest;
    }
    const ext = contentType.includes("png")
      ? ".png"
      : contentType.includes("webp")
        ? ".webp"
        : ".jpg";
    const dest = `${destBase}${ext}`;
    await writeFile(dest, Buffer.from(await res.arrayBuffer()));
    return dest;
  } catch {
    const dest = `${destBase}.png`;
    await makeSolidStill(dest, index);
    return dest;
  }
}

/** Fit full photo on 9:16 with dark letterbox — no blur (blur was the slow part). */
async function imageToClip(imagePath: string, outputPath: string, durationSecs: number) {
  await runFfmpeg([
    "-y",
    "-loop",
    "1",
    "-framerate",
    "24",
    "-i",
    imagePath,
    "-vf",
    `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x111418,setsar=1,format=yuv420p`,
    "-t",
    String(durationSecs),
    "-r",
    "24",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-tune",
    "stillimage",
    "-crf",
    "28",
    "-movflags",
    "+faststart",
    "-an",
    outputPath,
  ]);
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, {
      windowsHide: true,
      env: process.env,
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (err) => {
      reject(new Error(`ffmpeg failed to start: ${err.message}. Is FFmpeg on PATH?`));
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-800)}`));
    });
  });
}
