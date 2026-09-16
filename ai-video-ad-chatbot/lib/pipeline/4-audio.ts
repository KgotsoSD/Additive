import { spawn } from "child_process";
import { mkdir } from "fs/promises";
import path from "path";
import type { Storyboard } from "./types";

export interface AudioAssets {
  voiceoverUrl: string;
  musicUrl: string;
}

/**
 * Builds a local background music bed with FFmpeg (no API key required).
 */
export async function generateAudio(
  storyboard: Storyboard,
  projectId: string,
  style: string = "ugc"
): Promise<AudioAssets> {
  const uploadDir = path.join(process.cwd(), "public", "uploads");
  await mkdir(uploadDir, { recursive: true });

  const duration = Math.max(4, Math.min(Number(storyboard.totalDurationSecs) || 30, 60));
  const musicName = `${projectId}-music.mp3`;
  const musicPath = path.join(uploadDir, musicName);

  // Two soft tones mixed — different roots per style
  const f1 = style === "cinematic" ? 110 : style === "product" ? 196 : 146.83;
  const f2 = style === "cinematic" ? 164.81 : style === "product" ? 246.94 : 220;

  await runFfmpeg([
    "-y",
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=${f1}:sample_rate=44100:duration=${duration}`,
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=${f2}:sample_rate=44100:duration=${duration}`,
    "-filter_complex",
    `[0:a][1:a]amix=inputs=2:duration=longest:dropout_transition=2,volume=0.5,afade=t=in:st=0:d=0.8,afade=t=out:st=${Math.max(0.5, duration - 1.2)}:d=1.2`,
    "-t",
    String(duration),
    "-c:a",
    "libmp3lame",
    "-q:a",
    "5",
    musicPath,
  ]);

  return {
    voiceoverUrl: "solid://voiceover",
    musicUrl: `/uploads/${musicName}`,
  };
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { windowsHide: true, env: process.env });
    let stderr = "";
    child.stderr.on("data", (c) => {
      stderr += String(c);
    });
    child.on("error", (err) => reject(new Error(`ffmpeg audio: ${err.message}`)));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg audio exited ${code}: ${stderr.slice(-600)}`));
    });
  });
}
