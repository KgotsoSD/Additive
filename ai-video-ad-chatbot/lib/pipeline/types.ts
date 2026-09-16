export interface StoryboardScene {
  order: number;
  description: string; // what happens in the shot, for humans
  imagePrompt: string; // prompt to send to the image-gen API
  videoPrompt: string; // prompt to send to the video-gen API (often image-to-video)
  durationSecs: number;
}

export interface Storyboard {
  title: string;
  totalDurationSecs: number;
  voiceoverScript: string; // full voiceover line(s), timed across scenes
  musicMood: string; // e.g. "upbeat luxury, soft piano + strings"
  scenes: StoryboardScene[];
}

export interface GeneratedScene extends StoryboardScene {
  imageUrl: string;
  clipUrl: string;
}

export interface PipelineResult {
  finalVideoUrl: string;
  storyboard: Storyboard;
  scenes: GeneratedScene[];
}

/** One billable (or mocked) operation, persisted by the project runner. */
export interface UsageEvent {
  provider: string;
  operation: string;
  quantity: number;
  unit: string;
  costUsd: number;
  metadata?: Record<string, unknown>;
}

export type AdPlatform = "tiktok" | "instagram" | "youtube";
export type AdStyle = "ugc" | "cinematic" | "product";

export interface PipelineOptions {
  prompt: string;
  projectId: string;
  durationSecs?: number;
  platform?: AdPlatform;
  style?: AdStyle;
  productImages?: string[];
  onProgress?: (
    step: string,
    data?: { script?: Storyboard }
  ) => void | Promise<void>;
  onUsage?: (usage: UsageEvent) => void | Promise<void>;
}
