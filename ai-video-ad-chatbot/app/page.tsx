"use client";

import { FormEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";

type JobStatus =
  | "PENDING"
  | "SCRIPTING"
  | "GENERATING_IMAGES"
  | "GENERATING_VIDEO"
  | "ADDING_AUDIO"
  | "STITCHING"
  | "DONE"
  | "FAILED";

type Storyboard = {
  title: string;
  totalDurationSecs: number;
  voiceoverScript: string;
  musicMood: string;
  scenes: { order: number; description: string; durationSecs: number }[];
};

type AdPlatform = "tiktok" | "instagram" | "youtube";
type AdStyle = "ugc" | "cinematic" | "product";

type ChatMessage =
  | { id: string; role: "user"; text: string; images?: string[] }
  | {
      id: string;
      role: "assistant";
      text: string;
      status?: JobStatus;
      storyboard?: Storyboard | null;
      videoUrl?: string | null;
      productImages?: string[];
      error?: string | null;
    };

type Thread = {
  id: string;
  title: string;
  updatedAt: number;
  messages: ChatMessage[];
  /** Stable /uploads URLs carried across follow-up prompts in this chat */
  productImages?: string[];
  lastBrief?: string;
};

type LocalAsset = { id: string; preview: string; file: File };

const STORAGE_KEY = "Additive-threads-v2";

const PIPELINE: { key: JobStatus; label: string }[] = [
  { key: "SCRIPTING", label: "Script & storyboard" },
  { key: "GENERATING_IMAGES", label: "Scene stills" },
  { key: "GENERATING_VIDEO", label: "Motion clips" },
  { key: "ADDING_AUDIO", label: "Voice & music" },
  { key: "STITCHING", label: "Final stitch" },
];

const PLATFORMS: { id: AdPlatform; label: string; hint: string }[] = [
  { id: "tiktok", label: "TikTok", hint: "9:16 · punchy hooks" },
  { id: "instagram", label: "Reels", hint: "9:16 · IG native" },
  { id: "youtube", label: "Shorts", hint: "9:16 · YouTube" },
];

const STYLES: { id: AdStyle; label: string; hint: string }[] = [
  { id: "ugc", label: "UGC", hint: "Creator / handheld" },
  { id: "cinematic", label: "Cinematic", hint: "Brand film polish" },
  { id: "product", label: "Product", hint: "Clean showcase" },
];

const DURATIONS = [15, 20, 30];

const SUGGESTIONS = [
  {
    label: "Luxury hair",
    prompt:
      "Create a 30-second Instagram advert for my hair business. Make it luxurious, with a woman wearing a black body-wave wig.",
  },
  {
    label: "Cafe TikTok",
    prompt:
      "Make a 20-second TikTok ad for a neighborhood coffee shop. Warm morning light, latte art, cozy and inviting.",
  },
  {
    label: "Sneaker drop",
    prompt:
      "Create a 15-second product teaser for a limited sneaker drop. Bold, urban, high energy, night city vibes.",
  },
];

function statusIndex(status?: JobStatus) {
  if (!status || status === "PENDING") return -1;
  if (status === "DONE") return PIPELINE.length;
  if (status === "FAILED") return -1;
  return PIPELINE.findIndex((s) => s.key === status);
}

function assistantCopy(status: JobStatus, hasImages: boolean) {
  switch (status) {
    case "PENDING":
      return hasImages
        ? "Got your product shots — spinning up the ad job."
        : "On it — spinning up a new ad job.";
    case "SCRIPTING":
      return hasImages
        ? "Reading the brief and mapping your photos into a storyboard."
        : "Reading the brief and drafting the storyboard.";
    case "GENERATING_IMAGES":
      return hasImages
        ? "Storyboard locked. Framing your product photos per scene."
        : "Storyboard locked. Generating stills for each scene.";
    case "GENERATING_VIDEO":
      return "Stills are in. Turning each shot into motion.";
    case "ADDING_AUDIO":
      return "Clips ready. Laying down voiceover and music.";
    case "STITCHING":
      return "Almost there — stitching scenes into one cut.";
    case "DONE":
      return "Your ad is ready. Preview it on the board, then refine with another message or new photos.";
    case "FAILED":
      return "Something broke while generating this ad.";
    default:
      return "Working on your ad…";
  }
}

function titleFromPrompt(prompt: string) {
  const clean = prompt.replace(/\s+/g, " ").trim();
  return clean.length > 42 ? `${clean.slice(0, 42)}…` : clean;
}

function loadThreads(): Thread[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Thread[];
  } catch {
    return [];
  }
}

function looksLikeRevision(text: string) {
  return /\b(improve|fix|redo|retry|better|again|change|update|tweak|revise|make it|zoom|music|too|don't|dont|without losing)\b/i.test(
    text
  );
}

function stableUploads(urls: string[] | undefined | null) {
  if (!urls?.length) return [];
  return urls.filter((u) => typeof u === "string" && u.startsWith("/uploads/"));
}

async function readJson<T = Record<string, unknown>>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text.trim()) {
    throw new Error(`Empty response from server (${res.status}). Try again.`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Bad response from server (${res.status}). Try again.`);
  }
}

export default function Home() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [mobilePane, setMobilePane] = useState<"chat" | "board">("chat");
  const [hydrated, setHydrated] = useState(false);
  const [assets, setAssets] = useState<LocalAsset[]>([]);
  const [platform, setPlatform] = useState<AdPlatform>("instagram");
  const [style, setStyle] = useState<AdStyle>("ugc");
  const [durationSecs, setDurationSecs] = useState(30);
  const [dragging, setDragging] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const saved = loadThreads();
    setThreads(saved);
    setActiveId(saved[0]?.id ?? null);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(threads.slice(0, 30)));
  }, [threads, hydrated]);

  useEffect(() => {
    return () => {
      assets.forEach((a) => URL.revokeObjectURL(a.preview));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeThread = useMemo(
    () => threads.find((t) => t.id === activeId) ?? null,
    [threads, activeId]
  );
  const messages = activeThread?.messages ?? [];

  const latestAssistant = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === "assistant") return m;
    }
    return null;
  }, [messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  function createThread(seedMessages: ChatMessage[] = []) {
    const thread: Thread = {
      id: crypto.randomUUID(),
      title: seedMessages.find((m) => m.role === "user")?.text
        ? titleFromPrompt(seedMessages.find((m) => m.role === "user")!.text)
        : "New chat",
      updatedAt: Date.now(),
      messages: seedMessages,
    };
    setThreads((prev) => [thread, ...prev]);
    setActiveId(thread.id);
    return thread.id;
  }

  function patchThread(threadId: string, updater: (t: Thread) => Thread) {
    setThreads((prev) =>
      prev.map((t) => (t.id === threadId ? updater({ ...t, updatedAt: Date.now() }) : t))
    );
  }

  function updateAssistant(
    threadId: string,
    messageId: string,
    patch: Partial<Extract<ChatMessage, { role: "assistant" }>>
  ) {
    patchThread(threadId, (t) => ({
      ...t,
      messages: t.messages.map((m) =>
        m.id === messageId && m.role === "assistant" ? { ...m, ...patch } : m
      ),
    }));
  }

  function startNewChat() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setBusy(false);
    setInput("");
    setAssets((prev) => {
      prev.forEach((a) => URL.revokeObjectURL(a.preview));
      return [];
    });
    setMobilePane("chat");
    createThread();
  }

  function addFiles(fileList: FileList | File[]) {
    const incoming = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
    if (incoming.length === 0) return;

    setAssets((prev) => {
      const room = Math.max(0, 8 - prev.length);
      const next = incoming.slice(0, room).map((file) => ({
        id: crypto.randomUUID(),
        file,
        preview: URL.createObjectURL(file),
      }));
      return [...prev, ...next];
    });
  }

  function removeAsset(id: string) {
    setAssets((prev) => {
      const target = prev.find((a) => a.id === id);
      if (target) URL.revokeObjectURL(target.preview);
      return prev.filter((a) => a.id !== id);
    });
  }

  async function uploadAssets(files: LocalAsset[]): Promise<string[]> {
    if (files.length === 0) return [];
    const form = new FormData();
    files.forEach((a) => {
      // Normalize empty MIME types (common on Windows) so the upload API accepts them
      const name = a.file.name || `photo-${a.id}.jpg`;
      const type =
        a.file.type ||
        (name.toLowerCase().endsWith(".png")
          ? "image/png"
          : name.toLowerCase().endsWith(".webp")
            ? "image/webp"
            : name.toLowerCase().endsWith(".gif")
              ? "image/gif"
              : "image/jpeg");
      form.append("files", new File([a.file], name, { type }));
    });
    const res = await fetch("/api/upload", { method: "POST", body: form });
    const data = await readJson<{ urls?: string[]; error?: string }>(res);
    if (!res.ok) throw new Error(data.error ?? "Upload failed");
    if (!Array.isArray(data.urls) || data.urls.length === 0) {
      throw new Error("Upload returned no image URLs");
    }
    return data.urls;
  }

  async function startGeneration(prompt: string) {
    const trimmed = prompt.trim();
    const stagedAssets = assets;
    if ((!trimmed && stagedAssets.length === 0) || busy) return;

    const fromThread = stableUploads(activeThread?.productImages);
    const fromMessages = stableUploads(
      [...(activeThread?.messages ?? [])]
        .reverse()
        .find(
          (m): m is Extract<ChatMessage, { role: "assistant" }> =>
            m.role === "assistant" && Boolean(m.productImages?.length)
        )?.productImages
    );
    const priorUploads = fromThread.length ? fromThread : fromMessages;

    const priorBrief =
      activeThread?.lastBrief ||
      [...(activeThread?.messages ?? [])]
        .reverse()
        .find((m) => m.role === "user" && !looksLikeRevision(m.text))?.text;

    let finalPrompt =
      trimmed ||
      `Create a ${durationSecs}-second ${platform} ad from my product photos in a ${style} style.`;

    if (trimmed && looksLikeRevision(trimmed) && priorBrief) {
      finalPrompt =
        `Revise the previous ad. Keep the SAME product photos — do not drop or replace them.\n` +
        `Previous brief: ${priorBrief}\n` +
        `Revision request: ${trimmed}\n` +
        `Show each photo fully (no extreme zoom/crop), keep clear pacing, and include background music.`;
    }

    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }

    const localPreviews = stagedAssets.map((a) => a.preview);
    const displayImages = localPreviews.length ? localPreviews : priorUploads;
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text: trimmed || finalPrompt,
      images: displayImages,
    };
    const assistantId = crypto.randomUUID();
    const hasImages = displayImages.length > 0;
    const assistantMsg: Extract<ChatMessage, { role: "assistant" }> = {
      id: assistantId,
      role: "assistant",
      text: assistantCopy("PENDING", hasImages),
      status: "PENDING",
      productImages: displayImages,
    };

    let threadId = activeId;
    if (!threadId || !activeThread) {
      threadId = createThread([userMsg, assistantMsg]);
    } else {
      patchThread(threadId, (t) => ({
        ...t,
        title: t.messages.length === 0 ? titleFromPrompt(finalPrompt) : t.title,
        messages: [...t.messages, userMsg, assistantMsg],
      }));
    }

    setBusy(true);
    setInput("");
    setMobilePane("board");

    try {
      const uploaded = await uploadAssets(stagedAssets);
      const productImages = uploaded.length ? uploaded : priorUploads;

      if (hasImages && productImages.length === 0) {
        throw new Error(
          "Your product photos weren't available for this run. Drop them again and retry."
        );
      }

      patchThread(threadId, (t) => ({
        ...t,
        productImages: productImages.length ? productImages : t.productImages,
        lastBrief: looksLikeRevision(trimmed) ? t.lastBrief || priorBrief : finalPrompt,
      }));

      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: finalPrompt,
          userId: "demo-user",
          durationSecs,
          platform,
          style,
          productImages,
        }),
      });
      const data = await readJson<{ projectId?: string; error?: string }>(res);
      if (!res.ok || !data.projectId) {
        updateAssistant(threadId, assistantId, {
          status: "FAILED",
          text: assistantCopy("FAILED", hasImages),
          error: data.error ?? "Could not start generation.",
        });
        setBusy(false);
        return;
      }

      setAssets((prev) => {
        prev.forEach((a) => URL.revokeObjectURL(a.preview));
        return [];
      });

      let pollMisses = 0;
      pollRef.current = setInterval(async () => {
        try {
          const jobRes = await fetch(`/api/jobs/${data.projectId}`);
          const job = await readJson<{
            status?: JobStatus;
            productImages?: string[];
            script?: Storyboard | null;
            finalVideoUrl?: string | null;
            errorMessage?: string | null;
          }>(jobRes);

          if (!job.status) {
            pollMisses += 1;
            if (pollMisses > 5) throw new Error("Job status missing");
            return;
          }
          pollMisses = 0;

          const status = job.status;
          const jobImages = Array.isArray(job.productImages)
            ? job.productImages
            : productImages;

          updateAssistant(threadId!, assistantId, {
            status,
            text: assistantCopy(status, jobImages.length > 0),
            storyboard: job.script ?? undefined,
            videoUrl: job.finalVideoUrl,
            productImages: jobImages,
            error: job.errorMessage,
          });

          if (stableUploads(jobImages).length) {
            patchThread(threadId!, (t) => ({
              ...t,
              productImages: stableUploads(jobImages),
            }));
          }

          const finished =
            status === "DONE" ||
            status === "FAILED" ||
            (Boolean(job.finalVideoUrl) && status !== "FAILED");

          if (finished) {
            if (status !== "FAILED" && job.finalVideoUrl) {
              updateAssistant(threadId!, assistantId, {
                status: "DONE",
                text: assistantCopy("DONE", jobImages.length > 0),
                videoUrl: job.finalVideoUrl,
              });
            }
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setBusy(false);
          }
        } catch (pollErr) {
          pollMisses += 1;
          if (pollMisses < 4) return;
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          updateAssistant(threadId!, assistantId, {
            status: "FAILED",
            text: assistantCopy("FAILED", hasImages),
            error:
              pollErr instanceof Error
                ? pollErr.message
                : "Lost connection while checking job status.",
          });
          setBusy(false);
        }
      }, 1500);
    } catch (err) {
      updateAssistant(threadId, assistantId, {
        status: "FAILED",
        text: assistantCopy("FAILED", hasImages),
        error: err instanceof Error ? err.message : "Network error starting generation.",
      });
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void startGeneration(input);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  }

  const current = statusIndex(latestAssistant?.status);
  const storyboard = latestAssistant?.storyboard ?? null;
  const videoUrl = latestAssistant?.videoUrl ?? null;
  const playableVideo =
    videoUrl &&
    !/example\.com|example-cdn\.com|your-bucket/i.test(videoUrl)
      ? videoUrl
      : null;
  const boardImages =
    (latestAssistant?.productImages?.length
      ? latestAssistant.productImages
      : assets.map((a) => a.preview)) ?? [];
  const isLive =
    busy ||
    (latestAssistant?.status &&
      latestAssistant.status !== "DONE" &&
      latestAssistant.status !== "FAILED");

  return (
    <div
      className={`workspace ${dragging ? "dragging" : ""}`}
      onDragEnter={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={onDrop}
    >
      {dragging && (
        <div className="drop-overlay">
          <div className="drop-card">
            <strong>Drop product photos</strong>
            <span>We’ll build the ad from your images</span>
          </div>
        </div>
      )}

      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="mark" aria-hidden />
          <span>Additive</span>
        </div>

        <button type="button" className="new-chat" onClick={startNewChat}>
          + <span>New chat</span>
        </button>

        <div className="sidebar-label">Recent</div>
        <div className="thread-list">
          {threads.length === 0 && <div className="thread-empty">No chats yet</div>}
          {threads.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`thread-item ${t.id === activeId ? "active" : ""}`}
              onClick={() => {
                setActiveId(t.id);
                setMobilePane("chat");
              }}
            >
              {t.title || "Untitled"}
            </button>
          ))}
        </div>

        <div className="sidebar-foot">Photos + brief → finished ad</div>
      </aside>

      <section className="main">
        <header className="main-bar">
          <div>
            <h1>{activeThread?.title || "Creative agent"}</h1>
            <p>Drop product shots · chat the brief · ship a vertical ad</p>
          </div>
          <span className={`pill ${isLive ? "live" : ""}`}>
            {isLive ? "Generating" : latestAssistant?.status === "DONE" ? "Ready" : "Idle"}
          </span>
        </header>

        <div className="controls">
          <div className="control-group">
            <span className="control-label">Platform</span>
            <div className="seg">
              {PLATFORMS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={platform === p.id ? "on" : ""}
                  onClick={() => setPlatform(p.id)}
                  title={p.hint}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div className="control-group">
            <span className="control-label">Style</span>
            <div className="seg">
              {STYLES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={style === s.id ? "on" : ""}
                  onClick={() => setStyle(s.id)}
                  title={s.hint}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <div className="control-group">
            <span className="control-label">Length</span>
            <div className="seg">
              {DURATIONS.map((d) => (
                <button
                  key={d}
                  type="button"
                  className={durationSecs === d ? "on" : ""}
                  onClick={() => setDurationSecs(d)}
                >
                  {d}s
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mobile-tabs">
          <button
            type="button"
            className={mobilePane === "chat" ? "active" : ""}
            onClick={() => setMobilePane("chat")}
          >
            Chat
          </button>
          <button
            type="button"
            className={mobilePane === "board" ? "active" : ""}
            onClick={() => setMobilePane("board")}
          >
            Board
          </button>
        </div>

        <div className="chat-scroll" hidden={mobilePane === "board"}>
          {messages.length === 0 ? (
            <section className="empty">
              <div className="mark" aria-hidden />
              <h2>Product in. Ad out.</h2>
              <p>
                Drop product photos or describe the ad. Additive writes the storyboard, animates
                scenes, adds voice, and returns a finished cut — Creatify-style, chat-first.
              </p>
              <button
                type="button"
                className="dropzone"
                onClick={() => fileRef.current?.click()}
              >
                <strong>Drop images here</strong>
                <span>or click to upload · PNG, JPG, WEBP · up to 8</span>
              </button>
              <div className="chips">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    className="chip"
                    onClick={() => void startGeneration(s.prompt)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </section>
          ) : (
            <div className="messages">
              {messages.map((m) =>
                m.role === "user" ? (
                  <div key={m.id} className="row user">
                    <div className="avatar you">You</div>
                    <div className="bubble">
                      {m.images && m.images.length > 0 && (
                        <div className="msg-thumbs">
                          {m.images.map((src) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img key={src} src={src} alt="" />
                          ))}
                        </div>
                      )}
                      <p>{m.text}</p>
                    </div>
                  </div>
                ) : (
                  <div key={m.id} className="row assistant">
                    <div className="avatar bot">Sp</div>
                    <div className="bubble">
                      <p>{m.text}</p>
                      {m.error && <p className="error-text">{m.error}</p>}
                    </div>
                  </div>
                )
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        <div className="composer-wrap" hidden={mobilePane === "board"}>
          {assets.length > 0 && (
            <div className="asset-tray">
              {assets.map((a) => (
                <div key={a.id} className="asset">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={a.preview} alt="" />
                  <button type="button" onClick={() => removeAsset(a.id)} aria-label="Remove">
                    ×
                  </button>
                </div>
              ))}
              {assets.length < 8 && (
                <button
                  type="button"
                  className="asset-add"
                  onClick={() => fileRef.current?.click()}
                >
                  +
                </button>
              )}
            </div>
          )}
          <form className="composer" onSubmit={onSubmit}>
            <button
              type="button"
              className="attach"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              title="Add product photos"
            >
              ＋
            </button>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                assets.length
                  ? "Add a brief for these photos… or just hit Send"
                  : "Message Additive… or drop product photos"
              }
              rows={2}
              disabled={busy}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void startGeneration(input);
                }
              }}
              onPaste={(e) => {
                const files = Array.from(e.clipboardData.files).filter((f) =>
                  f.type.startsWith("image/")
                );
                if (files.length) {
                  e.preventDefault();
                  addFiles(files);
                }
              }}
            />
            <button
              className="send"
              type="submit"
              disabled={busy || (!input.trim() && assets.length === 0)}
            >
              {busy ? "…" : "Send"}
            </button>
          </form>
          <p className="composer-meta">
            Drop / paste images · Enter to send · {platform} · {style} · {durationSecs}s
          </p>
        </div>
      </section>

      <aside className={`board ${mobilePane === "board" ? "open" : ""}`}>
        <div className="board-head">
          <h2>Production board</h2>
          <span className={`pill ${isLive ? "live" : ""}`}>
            {latestAssistant?.status ?? "WAITING"}
          </span>
        </div>

        <div className="board-card">
          <h3>Preview · 9:16</h3>
          <div className="phone">
            <div className="phone-notch" />
            {playableVideo ? (
              <video key={playableVideo} controls playsInline src={playableVideo} poster={boardImages[0]} />
            ) : boardImages[0] ? (
              <div className="phone-still">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={boardImages[0]} alt="" />
                <span>{isLive ? "Animating…" : "Preview pending — run again"}</span>
              </div>
            ) : (
              <div className="phone-empty">
                <strong style={{ color: "#fff", fontSize: "0.95rem" }}>No cut yet</strong>
                <span>Drop photos or send a brief</span>
              </div>
            )}
          </div>
          {latestAssistant?.status === "DONE" && !playableVideo && (
            <p className="board-idle" style={{ marginTop: 10 }}>
              This run used a placeholder URL. Send the brief again to render a real preview clip.
            </p>
          )}
        </div>

        {boardImages.length > 0 && (
          <div className="board-card">
            <h3>Product assets</h3>
            <div className="asset-grid">
              {boardImages.map((src) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={src} src={src} alt="" />
              ))}
            </div>
          </div>
        )}

        <div className="board-card">
          <h3>Pipeline</h3>
          {latestAssistant?.status && latestAssistant.status !== "FAILED" ? (
            <div className="pipeline">
              {PIPELINE.map((step, i) => {
                const state =
                  current > i || latestAssistant.status === "DONE"
                    ? "done"
                    : current === i
                      ? "active"
                      : "";
                return (
                  <div key={step.key} className={`step ${state}`}>
                    <span className="step-dot" />
                    <span>{step.label}</span>
                    <span className="step-badge">
                      {state === "done" ? "Done" : state === "active" ? "Now" : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="board-idle">Send a brief or drop product photos to start.</p>
          )}
        </div>

        <div className="board-card">
          <h3>Storyboard</h3>
          {storyboard ? (
            <>
              <p className="voice" style={{ marginBottom: 10 }}>
                <strong>{storyboard.title}</strong> · {storyboard.totalDurationSecs}s ·{" "}
                {storyboard.musicMood}
              </p>
              <div className="scene-list">
                {storyboard.scenes.map((scene, idx) => (
                  <div key={scene.order} className="scene">
                    <div className="scene-thumb">
                      {boardImages[idx % Math.max(boardImages.length, 1)] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={boardImages[idx % boardImages.length]}
                          alt=""
                        />
                      ) : (
                        scene.order
                      )}
                    </div>
                    <div>
                      <strong>
                        Scene {scene.order} · {scene.durationSecs}s
                      </strong>
                      <p>{scene.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="board-idle">Scenes appear here after scripting finishes.</p>
          )}
        </div>

        {storyboard?.voiceoverScript && (
          <div className="board-card">
            <h3>Voiceover</h3>
            <p className="voice">{storyboard.voiceoverScript}</p>
          </div>
        )}
      </aside>

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) addFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
