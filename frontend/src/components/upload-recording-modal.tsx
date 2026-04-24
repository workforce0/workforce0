"use client";

import { useState, useRef, useCallback } from "react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Upload, FileAudio, X, Loader2, CheckCircle } from "lucide-react";

const ACCEPTED_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "video/mp4",
  "audio/wav",
  "audio/webm",
  "video/webm",
  "audio/x-m4a",
  "audio/mp4",
];

const ACCEPTED_EXTENSIONS = [".mp3", ".mp4", ".wav", ".webm", ".m4a"];
const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200MB

type UploadStage = "idle" | "uploading" | "confirming" | "transcribing" | "done" | "error";

interface UploadRecordingModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getExtension(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx).toLowerCase() : "";
}

export function UploadRecordingModal({ open, onClose, onSuccess }: UploadRecordingModalProps) {
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [stage, setStage] = useState<UploadStage>("idle");
  const [progress, setProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");
  const [dragOver, setDragOver] = useState(false);

  const reset = useCallback(() => {
    if (xhrRef.current) {
      xhrRef.current.abort();
      xhrRef.current = null;
    }
    setFile(null);
    setTitle("");
    setStage("idle");
    setProgress(0);
    setErrorMessage("");
    setDragOver(false);
  }, []);

  function handleClose() {
    if (stage === "uploading" || stage === "confirming") {
      // Don't allow closing during active upload
      return;
    }
    reset();
    onClose();
  }

  function validateFile(f: File): string | null {
    const ext = getExtension(f.name);
    const validType = ACCEPTED_TYPES.includes(f.type) || ACCEPTED_EXTENSIONS.includes(ext);
    if (!validType) {
      return "Unsupported file type. Please upload an MP3, MP4, WAV, WebM, or M4A file.";
    }
    if (f.size > MAX_FILE_SIZE) {
      return `File is too large (${formatFileSize(f.size)}). Maximum size is 200 MB.`;
    }
    if (f.size === 0) {
      return "This file appears to be empty.";
    }
    return null;
  }

  function selectFile(f: File) {
    const err = validateFile(f);
    if (err) {
      setErrorMessage(err);
      setStage("error");
      return;
    }
    setFile(f);
    setErrorMessage("");
    setStage("idle");
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) selectFile(dropped);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (selected) selectFile(selected);
    // Reset input so the same file can be re-selected
    e.target.value = "";
  }

  function removeFile() {
    setFile(null);
    setErrorMessage("");
    setStage("idle");
  }

  async function handleUpload() {
    if (!file) return;

    setStage("uploading");
    setProgress(0);
    setErrorMessage("");

    try {
      // Step 1: Get presigned URL
      const presignRes = await api.getUploadPresignUrl({
        fileName: file.name,
        fileSize: file.size,
        contentType: file.type || "application/octet-stream",
        title: title.trim() || undefined,
      });

      if (!presignRes.data) {
        throw new Error("Failed to get upload URL.");
      }

      const { meetingId, uploadUrl } = presignRes.data;

      // Step 2: Upload to S3 with progress tracking
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhrRef.current = xhr;

        xhr.upload.addEventListener("progress", (e) => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100);
            setProgress(pct);
          }
        });

        xhr.addEventListener("load", () => {
          xhrRef.current = null;
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(new Error(`Upload failed with status ${xhr.status}`));
          }
        });

        xhr.addEventListener("error", () => {
          xhrRef.current = null;
          reject(new Error("Network error during upload. Please check your connection."));
        });

        xhr.addEventListener("abort", () => {
          xhrRef.current = null;
          reject(new Error("Upload was cancelled."));
        });

        xhr.open("PUT", uploadUrl);
        xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
        xhr.send(file);
      });

      // Step 3: Confirm upload complete
      setStage("confirming");
      await api.confirmUploadComplete(meetingId, {
        title: title.trim() || undefined,
      });

      // Step 4: Show transcribing state
      setStage("transcribing");

      // Brief delay so user sees "Transcribing..." feedback
      await new Promise((r) => setTimeout(r, 1500));

      setStage("done");
      toast.success("Recording uploaded", "Your recording is being transcribed. We'll notify you when it's ready.");

      // Brief delay so user sees the success state
      await new Promise((r) => setTimeout(r, 800));

      reset();
      onClose();
      onSuccess();
    } catch (err) {
      setStage("error");
      if (err instanceof ApiError) {
        setErrorMessage(err.message);
      } else if (err instanceof Error) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage("An unexpected error occurred. Please try again.");
      }
    }
  }

  const isUploading = stage === "uploading" || stage === "confirming";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Upload Recording</DialogTitle>
          <DialogDescription>
            Upload an audio or video recording and we&apos;ll transcribe it automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Drag-and-drop zone */}
          {!file && stage !== "error" && (
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
              className={`
                relative flex flex-col items-center justify-center gap-3 p-8
                border-2 border-dashed rounded-xl cursor-pointer
                transition-all duration-200
                ${
                  dragOver
                    ? "border-accent bg-accent/[0.04] scale-[1.01]"
                    : "border-ink-faint/40 hover:border-ink-faint hover:bg-surface-hover"
                }
              `}
            >
              <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-accent-subtle">
                <Upload className="w-5 h-5 text-accent" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-ink">
                  Drag & drop your recording here
                </p>
                <p className="text-xs text-ink-tertiary mt-1">
                  or click to browse
                </p>
              </div>
              <p className="text-xs text-ink-faint">
                MP3, MP4, WAV, WebM, M4A &mdash; up to 200 MB
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_EXTENSIONS.join(",")}
                onChange={handleFileInput}
                className="hidden"
              />
            </div>
          )}

          {/* Error state in drop zone area */}
          {!file && stage === "error" && (
            <div className="flex flex-col items-center gap-3 p-8 border-2 border-dashed border-rose/30 rounded-xl bg-rose/[0.03]">
              <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-rose/10">
                <X className="w-5 h-5 text-rose" />
              </div>
              <p className="text-sm font-medium text-rose text-center">{errorMessage}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setStage("idle");
                  setErrorMessage("");
                }}
              >
                Try Again
              </Button>
            </div>
          )}

          {/* File info card */}
          {file && (
            <div className="flex items-center gap-3 p-3 rounded-xl bg-surface-sunken border border-ink/[0.06]">
              <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-accent-subtle flex-shrink-0">
                <FileAudio className="w-5 h-5 text-accent" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ink truncate">{file.name}</p>
                <p className="text-xs text-ink-tertiary">{formatFileSize(file.size)}</p>
              </div>
              {!isUploading && stage !== "transcribing" && stage !== "done" && (
                <button
                  onClick={removeFile}
                  className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-ink/[0.06] transition-colors"
                >
                  <X className="w-4 h-4 text-ink-tertiary" />
                </button>
              )}
            </div>
          )}

          {/* Title input */}
          {file && !isUploading && stage !== "transcribing" && stage !== "done" && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-ink-secondary">
                Title <span className="text-ink-faint">(optional)</span>
              </label>
              <Input
                placeholder="e.g. Sprint Planning - March 12"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
          )}

          {/* Upload progress */}
          {stage === "uploading" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-ink-secondary">Uploading...</span>
                <span className="text-sm font-semibold text-accent">{progress}%</span>
              </div>
              <Progress value={progress} />
            </div>
          )}

          {/* Confirming state */}
          {stage === "confirming" && (
            <div className="flex items-center gap-2 text-sm text-ink-secondary">
              <Loader2 className="w-4 h-4 animate-spin text-accent" />
              <span>Finalizing upload...</span>
            </div>
          )}

          {/* Transcribing state */}
          {stage === "transcribing" && (
            <div className="flex items-center gap-3 p-3 rounded-xl bg-accent/[0.04] border border-accent/20">
              <Loader2 className="w-5 h-5 animate-spin text-accent" />
              <div>
                <p className="text-sm font-medium text-ink">Transcribing...</p>
                <p className="text-xs text-ink-tertiary">This may take a few minutes. You&apos;ll be notified when it&apos;s ready.</p>
              </div>
            </div>
          )}

          {/* Done state */}
          {stage === "done" && (
            <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald/[0.04] border border-emerald/20">
              <CheckCircle className="w-5 h-5 text-emerald" />
              <p className="text-sm font-medium text-ink">Upload complete!</p>
            </div>
          )}

          {/* Error after file selected */}
          {file && stage === "error" && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-rose/[0.04] border border-rose/20">
              <X className="w-4 h-4 text-rose flex-shrink-0" />
              <p className="text-sm text-rose">{errorMessage}</p>
            </div>
          )}

          {/* Action buttons */}
          {file && stage !== "transcribing" && stage !== "done" && (
            <div className="flex gap-2 pt-2">
              <Button
                onClick={handleUpload}
                disabled={isUploading}
                className="flex-1"
              >
                {isUploading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Upload className="w-4 h-4" />
                )}
                {isUploading ? "Uploading..." : "Upload & Transcribe"}
              </Button>
              {!isUploading && (
                <Button variant="outline" onClick={handleClose}>
                  Cancel
                </Button>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
