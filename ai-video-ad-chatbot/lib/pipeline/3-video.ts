import type { StoryboardScene } from "./types";

/**
 * Turns a scene's still image into a short video clip (image-to-video is
 * generally more controllable than pure text-to-video for product/brand
 * consistency). When no provider is configured, the stitcher creates a real
 * local Ken Burns motion clip from the image; swap that fallback for
 * Runway/Luma/Kling/etc. for generative animation.
 */
export async function generateSceneClip(
  scene: StoryboardScene,
  imageUrl: string,
  projectId: string
): Promise<string> {
  if (!process.env.VIDEO_GEN_API_KEY?.trim()) {
    return `motion://scene-${scene.order}`;
  }

  // Prefer mock over crashing until a real provider is wired.
  console.warn(`[video] VIDEO_GEN_API_KEY set but provider not wired; using local motion for scene ${scene.order}`);
  return `motion://scene-${scene.order}`;
}
