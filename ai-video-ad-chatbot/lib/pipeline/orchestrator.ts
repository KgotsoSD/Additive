import { generateStoryboard } from "./1-script";
import { generateSceneImage } from "./2-images";
import { generateSceneClip } from "./3-video";
import { generateAudio } from "./4-audio";
import { stitchFinalVideo } from "./5-stitch";
import type { GeneratedScene, PipelineOptions, PipelineResult } from "./types";

/**
 * Runs the full prompt (+ optional product images) -> finished video pipeline.
 * Progress callbacks are awaited so later steps can't overwrite DONE.
 */
export async function runPipeline(options: PipelineOptions): Promise<PipelineResult> {
  const {
    prompt,
    projectId,
    durationSecs = 30,
    platform = "instagram",
    style = "ugc",
    productImages = [],
    onProgress,
    onUsage,
  } = options;

  const report = async (step: string, data?: { script?: PipelineResult["storyboard"] }) => {
    if (!onProgress) return;
    await onProgress(step, data);
  };

  await report("SCRIPTING");
  const storyboard = await generateStoryboard(prompt, durationSecs, {
    platform,
    style,
    productImageCount: productImages.length,
  });
  await onUsage?.({ provider: process.env.OPENAI_API_KEY ? "openai" : "mock", operation: "storyboard", quantity: 1, unit: "request", costUsd: 0 });

  await report("GENERATING_IMAGES", { script: storyboard });
  const withImages = await Promise.all(
    storyboard.scenes.map(async (scene) => ({
      ...scene,
      imageUrl: await generateSceneImage(scene, projectId, productImages),
    }))
  );
  await onUsage?.({ provider: process.env.IMAGE_GEN_API_KEY ? "image-provider" : "mock", operation: "scene-image", quantity: withImages.length, unit: "image", costUsd: 0 });

  await report("GENERATING_VIDEO");
  const scenes: GeneratedScene[] = await Promise.all(
    withImages.map(async (scene) => ({
      ...scene,
      clipUrl: await generateSceneClip(scene, scene.imageUrl, projectId),
    }))
  );
  await onUsage?.({ provider: process.env.VIDEO_GEN_API_KEY ? "video-provider" : "mock", operation: "scene-video", quantity: scenes.reduce((total, scene) => total + scene.durationSecs, 0), unit: "second", costUsd: 0 });

  await report("ADDING_AUDIO");
  const audio = await generateAudio(storyboard, projectId, style);
  await onUsage?.({ provider: process.env.VOICE_GEN_API_KEY ? "voice-provider" : "local-ffmpeg", operation: "audio", quantity: storyboard.totalDurationSecs, unit: "second", costUsd: 0 });

  await report("STITCHING");
  const finalVideoUrl = await stitchFinalVideo(scenes, audio, projectId);

  return { finalVideoUrl, storyboard, scenes };
}
