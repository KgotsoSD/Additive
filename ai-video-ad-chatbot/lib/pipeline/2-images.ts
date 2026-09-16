import type { StoryboardScene } from "./types";

/**
 * Generates one still image per scene.
 * When the user dropped product photos, reuse those (cycled across scenes).
 * Otherwise return a sentinel so stitch builds a real teal still with FFmpeg
 * (placehold.co SVGs are not ffmpeg-encodable).
 */
export async function generateSceneImage(
  scene: StoryboardScene,
  projectId: string,
  productImages: string[] = []
): Promise<string> {
  if (productImages.length > 0) {
    // Prefer 1:1 scene→photo when counts match; otherwise cycle safely
    const idx = Math.min(Math.max(scene.order - 1, 0), productImages.length - 1);
    return productImages[idx] ?? productImages[0];
  }

  return `solid://scene-${scene.order}`;
}
