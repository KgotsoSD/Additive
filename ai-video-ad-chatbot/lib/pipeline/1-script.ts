import OpenAI from "openai";
import { z } from "zod";
import type { AdPlatform, AdStyle, Storyboard } from "./types";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SceneSchema = z.object({
  order: z.number(),
  description: z.string(),
  imagePrompt: z.string(),
  videoPrompt: z.string(),
  durationSecs: z.number(),
});

const StoryboardSchema = z.object({
  title: z.string(),
  totalDurationSecs: z.number(),
  voiceoverScript: z.string(),
  musicMood: z.string(),
  scenes: z.array(SceneSchema),
});

const PLATFORM_LABEL: Record<AdPlatform, string> = {
  tiktok: "TikTok",
  instagram: "Instagram Reels",
  youtube: "YouTube Shorts",
};

const STYLE_LABEL: Record<AdStyle, string> = {
  ugc: "authentic UGC / handheld creator style",
  cinematic: "polished cinematic brand film",
  product: "clean product-first showcase",
};

/**
 * Turns a raw user prompt into a structured storyboard.
 * When product images are supplied, scenes should feature those assets
 * (image-to-video), not invent unrelated products.
 */
export async function generateStoryboard(
  prompt: string,
  durationSecs = 30,
  opts?: {
    platform?: AdPlatform;
    style?: AdStyle;
    productImageCount?: number;
  }
): Promise<Storyboard> {
  const platform = opts?.platform ?? "instagram";
  const style = opts?.style ?? "ugc";
  const imageCount = opts?.productImageCount ?? 0;

  if (!process.env.OPENAI_API_KEY?.trim()) {
    return mockStoryboard(prompt, durationSecs, platform, style, imageCount);
  }

  try {
    const system = `You are an ad creative director for performance social ads (Creatify / InstantClips style).
Produce a JSON storyboard for a ${durationSecs}-second vertical (9:16) ${PLATFORM_LABEL[platform]} ad
in a ${STYLE_LABEL[style]} look.
Break it into 4-6 scenes that together add up to ${durationSecs} seconds.
${
  imageCount > 0
    ? `The advertiser uploaded exactly ${imageCount} product photo(s). Create EXACTLY ${imageCount} scenes — one scene per photo in upload order (scene 1 = photo 1, etc). Do not invent extra scenes or different products. Describe framing/mood per shot; keep the full product visible (no extreme crop).`
    : "No product photos were uploaded — invent cohesive stills via imagePrompt. Break into 4-6 scenes."
}
For each scene provide: order, description, imagePrompt, videoPrompt (camera/motion for image-to-video), durationSecs.
Also provide voiceoverScript and musicMood.
Respond with JSON only: { title, totalDurationSecs, voiceoverScript, musicMood, scenes: [...] }`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    return StoryboardSchema.parse(JSON.parse(raw));
  } catch (err) {
    console.warn("[script] OpenAI failed, falling back to mock storyboard:", err);
    return mockStoryboard(prompt, durationSecs, platform, style, imageCount);
  }
}

function mockStoryboard(
  prompt: string,
  durationSecs: number,
  platform: AdPlatform,
  style: AdStyle,
  imageCount: number
): Storyboard {
  const hasAssets = imageCount > 0;
  // One scene per uploaded photo — never invent extras that become teal fillers
  const sceneCount = hasAssets ? Math.min(Math.max(imageCount, 1), 8) : 4;
  const per = Math.max(1.5, Math.round((durationSecs / sceneCount) * 10) / 10);

  const roles = ["Hook / open", "Hero product", "Detail / lifestyle", "Social proof", "Benefit", "CTA"];

  return {
    title: hasAssets ? "Product-led ad" : "Brief-led ad",
    totalDurationSecs: durationSecs,
    voiceoverScript: hasAssets
      ? "Meet the product people can't stop talking about. Real looks. Real feel. Tap to shop before it's gone."
      : "Luxury, redefined. Introducing a collection made for the moment you walk in. Effortless. Undeniable.",
    musicMood:
      style === "cinematic"
        ? "soft piano building into light strings"
        : style === "product"
          ? "clean modern beats, minimal"
          : "upbeat lo-fi creator energy",
    scenes: Array.from({ length: sceneCount }, (_, i) => ({
      order: i + 1,
      description: hasAssets
        ? `${roles[i % roles.length]} — product photo ${i + 1} for ${PLATFORM_LABEL[platform]} (${style}). Brief: "${prompt.slice(0, 100)}"`
        : `Scene ${i + 1} for ${PLATFORM_LABEL[platform]} (${style}): "${prompt.slice(0, 80)}"`,
      imagePrompt: hasAssets
        ? `Full-frame product photo ${i + 1}, keep entire subject visible, ${STYLE_LABEL[style]}, 9:16`
        : `Editorial still, scene ${i + 1}, ${STYLE_LABEL[style]}, cinematic lighting`,
      videoPrompt:
        style === "cinematic"
          ? `Slow cinematic push-in, scene ${i + 1}, subtle parallax`
          : style === "product"
            ? `Gentle product reveal, scene ${i + 1}`
            : `Soft handheld drift, scene ${i + 1}`,
      durationSecs: per,
    })),
  };
}
