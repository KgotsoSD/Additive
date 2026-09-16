import type { StoryboardScene } from "./types";

/**
 * Turns a scene's still image into a short video clip (image-to-video is
 * generally more controllable than pure text-to-video for product/brand
 * consistency). Swap for a real call to Runway/Luma/Kling/etc.
 */
export async function generateSceneClip(
  scene: StoryboardScene,
  imageUrl: string,
  projectId: string
): Promise<string> {
  if (!process.env.VIDEO_GEN_API_KEY?.trim()) {
    // Placeholder clip - a short local test MP4 you can replace with a real
    // sample asset during development.
    return `https://example-cdn.com/placeholder-clips/scene-${scene.order}.mp4`;
  }

  // Prefer mock over crashing until a real provider is wired.
  console.warn(`[video] VIDEO_GEN_API_KEY set but provider not wired; using placeholder for scene ${scene.order}`);
  return `https://example-cdn.com/placeholder-clips/scene-${scene.order}.mp4`;
}
