"use client";
import { useEffect } from "react";
import { useToast } from "@/components/ui/toast";

export function AgentJobNotifier() {
  const toast = useToast();

  useEffect(() => {
    const es = new EventSource("/api/events");

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "agent_job.status_changed") {
          if (data.status === "done") {
            toast.success(
              "Feature Complete",
              data.data?.prUrl
                ? `PR created: ${data.data.prUrl}`
                : "Agent job completed successfully."
            );
          } else if (data.status === "failed") {
            toast.error(
              "Job Failed",
              data.data?.error || "Agent job failed. Check the Jobs page for details."
            );
          }
        }
      } catch {
        // Ignore parse errors (heartbeat messages etc)
      }
    };

    es.onerror = () => {
      // SSE will auto-reconnect
    };

    return () => es.close();
  }, [toast]);

  return null; // This component renders nothing — just listens
}
