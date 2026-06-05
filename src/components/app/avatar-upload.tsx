"use client";

import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { Camera, Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

const MAX_INPUT_BYTES = 10 * 1024 * 1024; // 10MB pre-resize cap
const OUTPUT_DIM = 256; // final square size in pixels
const OUTPUT_QUALITY = 0.85;
const ACCEPT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

interface AvatarUploadProps {
  /** Current avatar — either a data URL or a regular http URL. Null if none set. */
  currentUrl: string | null;
  /** Initials to render in the placeholder circle when no avatar is set. */
  initials: string;
  /** Called with a JPEG data URL whenever the user picks a new image. */
  onChange: (dataUrl: string) => Promise<void> | void;
  /** Called when the user clicks Remove. */
  onRemove: () => Promise<void> | void;
  /** Disable interactions while a parent save is in flight. */
  disabled?: boolean;
}

/**
 * Square-crop + downscale an image file via canvas. Returns a JPEG data URL.
 *
 * We always go through canvas (even for already-small PNGs) because:
 *   - it normalizes EXIF rotation that browsers may or may not handle natively
 *   - it forces JPEG output, which is ~3× smaller than the equivalent PNG
 *   - it square-crops so the avatar circle never looks squished
 */
async function resizeToSquareJpegDataUrl(file: File): Promise<string> {
  if (file.size > MAX_INPUT_BYTES) {
    throw new Error("Image is larger than 10MB. Pick a smaller file.");
  }
  if (!ACCEPT_TYPES.includes(file.type)) {
    throw new Error("Unsupported image format. Use JPG, PNG, WebP, or GIF.");
  }

  const blobUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Couldn't read the image file."));
      el.src = blobUrl;
    });

    // Center-crop to square: take the smaller of width/height as the side.
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const sx = (img.naturalWidth - side) / 2;
    const sy = (img.naturalHeight - side) / 2;

    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT_DIM;
    canvas.height = OUTPUT_DIM;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas not supported in this browser.");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, sx, sy, side, side, 0, 0, OUTPUT_DIM, OUTPUT_DIM);
    return canvas.toDataURL("image/jpeg", OUTPUT_QUALITY);
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

export function AvatarUpload({
  currentUrl,
  initials,
  onChange,
  onRemove,
  disabled,
}: AvatarUploadProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);

  async function handleFile(file: File) {
    setBusy(true);
    try {
      const dataUrl = await resizeToSquareJpegDataUrl(file);
      await onChange(dataUrl);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't process the image");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-start gap-5">
      {/* Avatar circle — clickable + drag target */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => !disabled && !busy && inputRef.current?.click()}
        onKeyDown={(e) => {
          if (disabled || busy) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          if (disabled || busy) return;
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (disabled || busy) return;
          const file = e.dataTransfer.files[0];
          if (file) void handleFile(file);
        }}
        aria-label="Change profile photo"
        className={`group relative flex h-24 w-24 cursor-pointer items-center justify-center overflow-hidden rounded-full ring-2 ring-offset-2 ring-offset-surface transition-all focus:outline-none focus-visible:ring-brand ${
          drag ? "ring-brand" : "ring-border/60 hover:ring-foreground/40"
        } ${disabled || busy ? "cursor-not-allowed opacity-60" : ""}`}
      >
        {currentUrl ? (
          <img
            src={currentUrl}
            alt="Profile"
            className="h-full w-full object-cover"
            draggable={false}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-brand to-violet text-2xl font-semibold text-white">
            {initials}
          </div>
        )}

        {/* Hover overlay */}
        <motion.div
          initial={false}
          animate={{ opacity: busy ? 1 : drag ? 1 : 0 }}
          whileHover={busy ? undefined : { opacity: 1 }}
          className="absolute inset-0 flex items-center justify-center bg-foreground/55 text-background"
        >
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
        </motion.div>
      </div>

      {/* Actions */}
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm font-medium">Profile photo</p>
        <p className="text-xs text-muted-foreground">
          PNG, JPG, WebP, or GIF · cropped to a 256×256 square automatically.
        </p>
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={disabled || busy}
            className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-background px-2.5 py-1 text-xs transition-colors hover:bg-accent disabled:opacity-50"
          >
            <Upload className="h-3 w-3" /> {currentUrl ? "Change" : "Upload"}
          </button>
          {currentUrl && (
            <button
              type="button"
              onClick={() => onRemove()}
              disabled={disabled || busy}
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
            >
              <Trash2 className="h-3 w-3" /> Remove
            </button>
          )}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_TYPES.join(",")}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          // Reset so picking the same file twice still fires onChange.
          e.target.value = "";
        }}
      />
    </div>
  );
}
