"use client";

import { useRef, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import "react-easy-crop/react-easy-crop.css";

import { Avatar } from "@/components/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const AVATAR_CLASS =
  "flex h-32 w-32 items-center justify-center overflow-hidden rounded-full bg-muted text-3xl font-semibold text-muted-foreground";

// Largest dimension we keep a picked source at. Bounding the source
// once, here, means the crop UI and the extraction canvas never hold
// the full-resolution image — the mobile-OOM guard from
// docs/design-profile-pictures.md.
const MAX_SOURCE_DIMENSION = 1600;
// Master size stored; the server re-encodes to the same dimension.
const OUTPUT_DIMENSION = 1024;

const getContext = (canvas: HTMLCanvasElement): CanvasRenderingContext2D => {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context unavailable");
  return ctx;
};

// Decodes a picked file, applying EXIF orientation, and re-draws it
// down to MAX_SOURCE_DIMENSION. Returns an object URL for the bounded
// image — the caller owns revoking it.
const boundSource = async (file: File): Promise<string> => {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, MAX_SOURCE_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  getContext(canvas).drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  // The bounded image is both what the cropper displays and what
  // cropToWebp extracts the final crop from, so its quality is a real
  // link in the chain — but it only needs to sit above the final
  // encode (0.88) to not be the limiting generation; higher just grows
  // the blob. The object URL is revoked when the modal closes.
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.92));
  if (!blob) throw new Error("could not process image");
  return URL.createObjectURL(blob);
};

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = src;
  });

// Draws the chosen crop rectangle into a square OUTPUT_DIMENSION canvas
// and exports it as a WebP blob. `area` is in the bounded source's
// pixel space, so it lines up with the image loaded here.
const cropToWebp = async (src: string, area: Area): Promise<Blob> => {
  const img = await loadImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_DIMENSION;
  canvas.height = OUTPUT_DIMENSION;
  getContext(canvas).drawImage(img, area.x, area.y, area.width, area.height, 0, 0, OUTPUT_DIMENSION, OUTPUT_DIMENSION);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.88));
  if (!blob) throw new Error("could not encode image");
  return blob;
};

type Status = { kind: "idle" } | { kind: "busy" } | { kind: "error"; message: string };

// Profile-picture upload. Lives above the profile form and acts on its
// own — picking and confirming a crop uploads immediately, independent
// of the form's Save button.
export function AvatarUploader({ name, initialUrl }: { name: string | null; initialUrl: string | null }) {
  const [url, setUrl] = useState(initialUrl);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const busy = status.kind === "busy";

  const closeCropper = () => {
    setCropSrc((src) => {
      if (src) URL.revokeObjectURL(src);
      return null;
    });
  };

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset so picking the same file again still fires onChange.
    event.target.value = "";
    if (!file) return;

    setStatus({ kind: "idle" });
    try {
      const bounded = await boundSource(file);
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setArea(null);
      setCropSrc(bounded);
    } catch {
      setStatus({ kind: "error", message: "Couldn't read that image. Try a PNG or JPEG." });
    }
  };

  const handleSave = async () => {
    if (!cropSrc || !area) return;
    setStatus({ kind: "busy" });
    try {
      const blob = await cropToWebp(cropSrc, area);
      const form = new FormData();
      form.append("file", blob, "avatar.webp");

      const res = await fetch("/api/me/avatar", { method: "POST", body: form, credentials: "include" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Upload failed.");
      }
      const { avatarUrl } = (await res.json()) as { avatarUrl: string };

      setUrl(avatarUrl);
      setStatus({ kind: "idle" });
      closeCropper();
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : "Upload failed." });
    }
  };

  const handleRemove = async () => {
    setStatus({ kind: "busy" });
    try {
      const res = await fetch("/api/me/avatar", { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Couldn't remove the photo.");
      setUrl(null);
      setStatus({ kind: "idle" });
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : "Couldn't remove the photo." });
    }
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <Avatar name={name} url={url} sizes="128px" priority className={AVATAR_CLASS} />

      <div className="flex gap-2">
        <Button type="button" onClick={() => fileInputRef.current?.click()} disabled={busy}>
          {url ? "Change photo" : "Upload photo"}
        </Button>
        {url && (
          <Button type="button" variant="ghost" onClick={handleRemove} disabled={busy}>
            Remove
          </Button>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={handleFile}
      />

      {status.kind === "error" && !cropSrc && (
        <p role="alert" className="text-sm text-destructive">
          {status.message}
        </p>
      )}

      <Dialog
        open={cropSrc !== null}
        onOpenChange={(open) => {
          if (!open) closeCropper();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Position your photo</DialogTitle>
          </DialogHeader>

          {cropSrc && (
            <>
              <div className="relative h-72 w-full overflow-hidden rounded bg-muted">
                <Cropper
                  image={cropSrc}
                  crop={crop}
                  zoom={zoom}
                  aspect={1}
                  cropShape="round"
                  showGrid={false}
                  onCropChange={setCrop}
                  onZoomChange={setZoom}
                  onCropComplete={(_area, areaPixels) => setArea(areaPixels)}
                />
              </div>
              <label className="flex items-center gap-3 text-sm">
                Zoom
                <input
                  type="range"
                  min={1}
                  max={3}
                  step={0.01}
                  value={zoom}
                  onChange={(e) => setZoom(Number(e.target.value))}
                  className="flex-1"
                  aria-label="Zoom"
                />
              </label>
              {status.kind === "error" && (
                <p role="alert" className="text-sm text-destructive">
                  {status.message}
                </p>
              )}
            </>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={closeCropper} disabled={busy}>
              Cancel
            </Button>
            <Button type="button" onClick={handleSave} disabled={busy || !area}>
              {busy ? "Saving…" : "Save photo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
