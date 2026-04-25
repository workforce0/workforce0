"use client";
import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Cpu, HardDrive, MemoryStick } from "lucide-react";

export interface HardwareProfile {
  totalRamGB: number;
  cpuCores: number;
  availableForLLM_GB: number;
  recommendedTier: "light" | "default" | "heavy";
}

export function HardwareCheck({ onDetected }: { onDetected: (p: HardwareProfile) => void }) {
  const [profile, setProfile] = useState<HardwareProfile | null>(null);

  useEffect(() => {
    fetch("/api/setup/hardware", { credentials: "include" })
      .then((r) => r.json())
      .then((j: { data: HardwareProfile }) => {
        setProfile(j.data);
        onDetected(j.data);
      })
      .catch(() => {
        const fallback: HardwareProfile = {
          totalRamGB: 0,
          cpuCores: 0,
          availableForLLM_GB: 0,
          recommendedTier: "default",
        };
        setProfile(fallback);
        onDetected(fallback);
      });
  }, [onDetected]);

  if (!profile) return <div className="p-4 text-sm">Detecting hardware…</div>;

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <h3 className="text-lg font-semibold">Hardware check</h3>
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div className="flex items-center gap-2">
            <MemoryStick className="h-4 w-4" /> {profile.totalRamGB} GB RAM
          </div>
          <div className="flex items-center gap-2">
            <Cpu className="h-4 w-4" /> {profile.cpuCores} CPU cores
          </div>
          <div className="flex items-center gap-2">
            <HardDrive className="h-4 w-4" /> {profile.availableForLLM_GB} GB free for AI
          </div>
        </div>
        <p className="text-sm text-ink-tertiary">
          Recommended tier: <strong>{profile.recommendedTier}</strong>. You can change this later in Settings.
        </p>
      </CardContent>
    </Card>
  );
}
