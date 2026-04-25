"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { X, Sparkles } from "lucide-react";

/**
 * Step0MigrationBanner — shown to existing tenants who haven't yet
 * gone through the new local-everything setup wizard. Reads
 * /api/setup/state to decide whether to show; the user can either
 * jump back into the wizard ("Configure") or dismiss until next
 * release ("X").
 */
export function Step0MigrationBanner() {
  const [show, setShow] = useState(false);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/setup/state", { credentials: "include" })
      .then((r) => r.json())
      .then((j: { data: { step0Migrated: boolean; step0Dismissed: boolean } }) => {
        setShow(!j.data.step0Migrated && !j.data.step0Dismissed);
      })
      .catch(() => setShow(false));
  }, []);

  async function dismiss() {
    setShow(false);
    await fetch("/api/setup/dismiss-step0", {
      method: "POST",
      credentials: "include",
    });
  }

  if (!show) return null;
  return (
    <div className="bg-violet-light/20 border border-violet/30 rounded p-3 flex items-center gap-2 text-sm">
      <Sparkles className="h-4 w-4 text-violet flex-shrink-0" />
      <span className="flex-1">
        <strong>Workforce0 v0.6 adds local-first features.</strong> Run models on this machine, bundled meeting capture, local transcription. BYOK keeps working.
      </span>
      <Button size="sm" onClick={() => router.push("/setup?step0=1")}>
        Configure
      </Button>
      <Button size="sm" variant="ghost" onClick={dismiss}>
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
