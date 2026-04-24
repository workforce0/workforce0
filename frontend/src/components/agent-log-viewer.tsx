"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { Badge } from "@/components/ui/badge";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgentLogViewerProps {
  jobId: string;
  tenantId?: string;
}

type JobStatus = "in_progress" | "done" | "failed" | null;

interface SSEEvent {
  type: string;
  jobId: string;
  status: string;
  message?: string;
  percent?: number;
  logs?: string[];
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AgentLogViewer({ jobId }: AgentLogViewerProps) {
  const [lines, setLines] = useState<string[]>([]);
  const [status, setStatus] = useState<JobStatus>(null);
  const [message, setMessage] = useState<string>("");
  const [percent, setPercent] = useState<number>(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);

  // Auto-scroll to bottom when new lines arrive
  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [lines, scrollToBottom]);

  useEffect(() => {
    const es = new EventSource("/api/events");
    esRef.current = es;

    es.onmessage = (event) => {
      try {
        const data: SSEEvent = JSON.parse(event.data);

        if (data.type !== "agent_job.status_changed") return;
        if (data.jobId !== jobId) return;

        // Update status
        if (data.status === "done" || data.status === "failed") {
          setStatus(data.status as JobStatus);
        } else if (data.status === "in_progress") {
          setStatus("in_progress");
        }

        // Update message and percent
        if (data.message) setMessage(data.message);
        if (data.percent !== undefined) setPercent(data.percent);

        // Append log lines
        if (data.logs && data.logs.length > 0) {
          setLines((prev) => [...prev, ...data.logs!]);
        }
      } catch {
        // Ignore malformed events
      }
    };

    es.onerror = () => {
      // EventSource auto-reconnects; nothing to do here
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [jobId]);

  // ─── Render ─────────────────────────────────────────────────────────────────

  const isTerminal = status === "done" || status === "failed";

  return (
    <div className="space-y-3">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-semibold text-ink">Agent Logs</h4>
          {status === "in_progress" && (
            <Badge className="bg-amber-light text-amber border-0 font-medium">
              In Progress{percent > 0 ? ` (${percent}%)` : ""}
            </Badge>
          )}
          {status === "done" && (
            <Badge className="bg-emerald-light text-emerald border-0 font-medium">
              Done
            </Badge>
          )}
          {status === "failed" && (
            <Badge className="bg-rose-light text-rose border-0 font-medium">
              Failed
            </Badge>
          )}
        </div>
        {message && (
          <span className="text-xs text-ink-tertiary truncate max-w-[240px]">
            {message}
          </span>
        )}
      </div>

      {/* Progress bar */}
      {status === "in_progress" && percent > 0 && (
        <div className="w-full bg-ink/[0.06] rounded-full h-1.5">
          <div
            className="bg-violet h-1.5 rounded-full transition-all duration-500"
            style={{ width: `${Math.min(percent, 100)}%` }}
          />
        </div>
      )}

      {/* Terminal-style log output */}
      <div
        ref={scrollRef}
        className="bg-[#1a1a2e] rounded-xl border border-ink/[0.08] p-4 font-mono text-xs leading-relaxed overflow-y-auto max-h-[400px] min-h-[200px]"
      >
        {lines.length === 0 && !isTerminal ? (
          <p className="text-gray-500 animate-pulse">Waiting for logs...</p>
        ) : (
          <>
            {lines.map((line, i) => (
              <div key={i} className="text-gray-300 whitespace-pre-wrap break-all">
                {line}
              </div>
            ))}
            {isTerminal && (
              <div
                className={`mt-2 pt-2 border-t border-white/10 font-semibold ${
                  status === "done" ? "text-emerald-400" : "text-rose-400"
                }`}
              >
                {status === "done"
                  ? "--- Job completed successfully ---"
                  : "--- Job failed ---"}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
