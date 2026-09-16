import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { nanoid } from "nanoid";

const MAX_FILES = 8;
const MAX_BYTES = 8 * 1024 * 1024; // 8MB each

const EXT_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

function resolveType(file: File): string | null {
  if (["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) {
    return file.type;
  }
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return EXT_MIME[ext] ?? null;
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);

    if (files.length === 0) {
      return NextResponse.json({ error: "No files uploaded" }, { status: 400 });
    }
    if (files.length > MAX_FILES) {
      return NextResponse.json({ error: `Max ${MAX_FILES} images` }, { status: 400 });
    }

    const uploadDir = path.join(process.cwd(), "public", "uploads");
    await mkdir(uploadDir, { recursive: true });

    const urls: string[] = [];

    for (const file of files) {
      const mime = resolveType(file);
      if (!mime) {
        return NextResponse.json(
          { error: `Unsupported type: ${file.type || file.name}. Use JPG, PNG, WEBP, or GIF.` },
          { status: 400 }
        );
      }
      if (file.size > MAX_BYTES) {
        return NextResponse.json({ error: `${file.name} exceeds 8MB` }, { status: 400 });
      }

      const ext =
        mime === "image/png"
          ? "png"
          : mime === "image/webp"
            ? "webp"
            : mime === "image/gif"
              ? "gif"
              : "jpg";
      const name = `${nanoid(12)}.${ext}`;
      const bytes = Buffer.from(await file.arrayBuffer());
      await writeFile(path.join(uploadDir, name), bytes);
      urls.push(`/uploads/${name}`);
    }

    return NextResponse.json({ urls });
  } catch (err) {
    console.error("[upload]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 500 }
    );
  }
}
