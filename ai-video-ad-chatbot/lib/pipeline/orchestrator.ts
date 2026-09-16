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

  await report("GENERATING_IMAGES", { script: storyboard });
  const withImages = await Promise.all(
    storyboard.scenes.map(async (scene) => ({
      ...scene,
      imageUrl: await generateSceneImage(scene, projectId, productImages),
    }))
  );

  await report("GENERATING_VIDEO");
  const scenes: GeneratedScene[] = await Promise.all(
    withImages.map(async (scene) => ({
      ...scene,
      clipUrl: await generateSceneClip(scene, scene.imageUrl, projectId),
    }))
  );

  await report("ADDING_AUDIO");
  const audio = await generateAudio(storyboard, projectId, style);

  await report("STITCHING");
  const finalVideoUrl = await stitchFinalVideo(scenes, audio, projectId);

  return { finalVideoUrl, storyboard, scenes };
}
