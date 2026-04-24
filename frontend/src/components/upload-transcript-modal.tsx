"use client";

import { useState, useRef, useCallback } from "react";
import { api } from "@/lib/api";
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
import { FileText, Upload, X, Loader2 } from "lucide-react";

interface UploadTranscriptModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const ACCEPTED_TRANSCRIPT_EXTENSIONS = [".vtt", ".srt", ".txt"];
const MAX_TRANSCRIPT_FILE_SIZE = 5 * 1024 * 1024; // 5MB

function parseVTT(content: string): string {
  return content
    .split("\n")
    .filter(
      (line) =>
        !line.match(/^\d/) &&
        !line.match(/-->/) &&
        !line.match(/^WEBVTT/) &&
        line.trim()
    )
    .join("\n")
    .trim();
}

function parseSRT(content: string): string {
  return content
    .split("\n")
    .filter(
      (line) =>
        !line.match(/^\d+$/) &&
        !line.match(/-->/) &&
        line.trim()
    )
    .join("\n")
    .trim();
}

function getFileExtension(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx).toLowerCase() : "";
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type TabMode = "paste" | "upload";

export function UploadTranscriptModal({ open, onClose, onSuccess }: UploadTranscriptModalProps) {
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [tab, setTab] = useState<TabMode>("paste");
  const [title, setTitle] = useState("");
  const [transcript, setTranscript] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // File upload state
  const [dragOver, setDragOver] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState("");
  const [fileLoading, setFileLoading] = useState(false);

  const resetFileState = useCallback(() => {
    setUploadedFile(null);
    setFileError("");
    setFileLoading(false);
    setDragOver(false);
  }, []);

  function handleClose() {
    if (submitting) return;
    setTitle("");
    setTranscript("");
    setTab("paste");
    resetFileState();
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || transcript.trim().length < 10) return;

    setSubmitting(true);
    try {
      await api.uploadTranscript({
        title: title.trim(),
        transcript: transcript.trim(),
      });
      toast.success("Transcript uploaded", "AI is analyzing the transcript and will generate a brief.");
      setTitle("");
      setTranscript("");
      setTab("paste");
      resetFileState();
      onClose();
      onSuccess();
    } catch {
      toast.error("Upload failed", "Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function validateTranscriptFile(f: File): string | null {
    const ext = getFileExtension(f.name);
    if (!ACCEPTED_TRANSCRIPT_EXTENSIONS.includes(ext)) {
      return "Unsupported file type. Please upload a .vtt, .srt, or .txt file.";
    }
    if (f.size > MAX_TRANSCRIPT_FILE_SIZE) {
      return `File is too large (${formatFileSize(f.size)}). Maximum size is 5 MB.`;
    }
    if (f.size === 0) {
      return "This file appears to be empty.";
    }
    return null;
  }

  async function processFile(f: File) {
    const err = validateTranscriptFile(f);
    if (err) {
      setFileError(err);
      setUploadedFile(null);
      return;
    }

    setFileLoading(true);
    setFileError("");
    setUploadedFile(f);

    try {
      const text = await f.text();
      const ext = getFileExtension(f.name);
      let parsed: string;

      if (ext === ".vtt") {
        parsed = parseVTT(text);
      } else if (ext === ".srt") {
        parsed = parseSRT(text);
      } else {
        parsed = text.trim();
      }

      setTranscript(parsed);
    } catch {
      setFileError("Failed to read file. Please try again.");
      setUploadedFile(null);
    } finally {
      setFileLoading(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) processFile(dropped);
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
    if (selected) processFile(selected);
    e.target.value = "";
  }

  function removeFile() {
    resetFileState();
    setTranscript("");
  }

  function handleTabChange(newTab: TabMode) {
    setTab(newTab);
    if (newTab === "paste") {
      resetFileState();
      setTranscript("");
    }
  }

  const wordCount = transcript.trim().split(/\s+/).filter(Boolean).length;
  const canSubmit = !submitting && title.trim() && transcript.trim().length >= 10;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>New work</DialogTitle>
          <DialogDescription>
            Paste a transcript, a written brief, a Loom + your notes, a Linear ticket, or even a
            one-sentence description — whatever you have. AI generates a draft brief; you review and
            approve before anything gets built.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          {/* Tab toggle */}
          <div className="flex rounded-xl border border-ink/[0.10] bg-surface-sunken p-1 gap-1">
            <button
              type="button"
              onClick={() => handleTabChange("paste")}
              className={`flex-1 flex items-center justify-center gap-2 py-1.5 px-3 rounded-lg text-sm font-medium transition-all duration-150 ${
                tab === "paste"
                  ? "bg-white dark:bg-slate-800 text-ink shadow-sm"
                  : "text-ink-tertiary hover:text-ink"
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              Paste Text
            </button>
            <button
              type="button"
              onClick={() => handleTabChange("upload")}
              className={`flex-1 flex items-center justify-center gap-2 py-1.5 px-3 rounded-lg text-sm font-medium transition-all duration-150 ${
                tab === "upload"
                  ? "bg-white dark:bg-slate-800 text-ink shadow-sm"
                  : "text-ink-tertiary hover:text-ink"
              }`}
            >
              <Upload className="w-3.5 h-3.5" />
              Upload File
            </button>
          </div>

          {/* Title */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-ink-secondary">Title</label>
            <Input
              placeholder="e.g. Add bulk export to dashboard · Sprint planning Mar 20 · LINEAR-4231"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>

          {/* Paste tab */}
          {tab === "paste" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-ink-secondary">Describe the work</label>
                {wordCount > 0 && (
                  <span className="text-xs text-ink-faint">{wordCount.toLocaleString()} words</span>
                )}
              </div>
              <textarea
                className="w-full min-h-[200px] max-h-[400px] p-3 text-sm rounded-xl border border-ink/[0.12] bg-white dark:bg-slate-900 resize-y focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
                placeholder={"Paste whatever context you have — a written brief, a meeting transcript, Loom notes, a Linear ticket description, or just a sentence or two describing what you want.\n\nStructured inputs (written briefs, explicit requirements) produce the best briefs. Raw meeting transcripts work too but benefit from a quick human pass first."}
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                required
                minLength={10}
              />
            </div>
          )}

          {/* Upload File tab */}
          {tab === "upload" && (
            <div className="space-y-3">
              {/* Drop zone — shown when no file selected */}
              {!uploadedFile && !fileError && (
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
                      Drag &amp; drop your transcript here
                    </p>
                    <p className="text-xs text-ink-tertiary mt-1">or click to browse</p>
                  </div>
                  <p className="text-xs text-ink-faint">
                    VTT, SRT, TXT &mdash; up to 5 MB
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={ACCEPTED_TRANSCRIPT_EXTENSIONS.join(",")}
                    onChange={handleFileInput}
                    className="hidden"
                  />
                </div>
              )}

              {/* File error state */}
              {fileError && !uploadedFile && (
                <div className="flex flex-col items-center gap-3 p-8 border-2 border-dashed border-rose/30 rounded-xl bg-rose/[0.03]">
                  <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-rose/10">
                    <X className="w-5 h-5 text-rose" />
                  </div>
                  <p className="text-sm font-medium text-rose text-center">{fileError}</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setFileError("");
                      setUploadedFile(null);
                    }}
                  >
                    Try Again
                  </Button>
                </div>
              )}

              {/* File selected card */}
              {uploadedFile && (
                <div className="flex items-center gap-3 p-3 rounded-xl bg-surface-sunken border border-ink/[0.06]">
                  <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-accent-subtle flex-shrink-0">
                    {fileLoading ? (
                      <Loader2 className="w-5 h-5 text-accent animate-spin" />
                    ) : (
                      <FileText className="w-5 h-5 text-accent" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ink truncate">{uploadedFile.name}</p>
                    <p className="text-xs text-ink-tertiary">
                      {fileLoading ? "Reading file..." : `${formatFileSize(uploadedFile.size)} · ${wordCount.toLocaleString()} words extracted`}
                    </p>
                  </div>
                  {!fileLoading && (
                    <button
                      type="button"
                      onClick={removeFile}
                      className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-ink/[0.06] transition-colors"
                    >
                      <X className="w-4 h-4 text-ink-tertiary" />
                    </button>
                  )}
                </div>
              )}

              {/* Extracted text preview */}
              {uploadedFile && !fileLoading && transcript && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-ink-tertiary">Extracted text preview</label>
                    <span className="text-xs text-ink-faint">{wordCount.toLocaleString()} words</span>
                  </div>
                  <textarea
                    className="w-full min-h-[120px] max-h-[240px] p-3 text-sm rounded-xl border border-ink/[0.12] bg-white dark:bg-slate-900 resize-y focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
                    value={transcript}
                    onChange={(e) => setTranscript(e.target.value)}
                  />
                </div>
              )}

              {/* Inline hidden input for file tab so the file input is always in DOM when needed */}
              {uploadedFile && (
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPTED_TRANSCRIPT_EXTENSIONS.join(",")}
                  onChange={handleFileInput}
                  className="hidden"
                />
              )}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button
              type="submit"
              disabled={!canSubmit || fileLoading}
              className="flex-1"
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <FileText className="w-4 h-4" />
              )}
              {submitting ? "Processing..." : "Upload & Analyze"}
            </Button>
            <Button type="button" variant="outline" onClick={handleClose} disabled={submitting}>
              Cancel
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
