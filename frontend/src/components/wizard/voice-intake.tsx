"use client";
import { Card, CardContent } from "@/components/ui/card";

export interface VoiceIntakeConfig {
  enabled: boolean;
  twilioNumber: string;
  callerAllowlist: string[];
  pin?: string;
}

export function VoiceIntake({
  value,
  onChange,
}: {
  value: VoiceIntakeConfig;
  onChange: (next: VoiceIntakeConfig) => void;
}) {
  return (
    <Card>
      <CardContent className="space-y-3 p-6">
        <h3 className="text-lg font-semibold">Voice intake (optional)</h3>
        <p className="text-sm text-muted-foreground">
          Inbound phone hotline. Caller dials your Twilio number and talks to a
          local agent. Transcript flows into the same brief pipeline as a
          manual upload.
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={value.enabled}
            onChange={(e) => onChange({ ...value, enabled: e.target.checked })}
          />
          Enable inbound voice intake
        </label>
        {value.enabled && (
          <div className="space-y-2 pt-2">
            <input
              type="tel"
              placeholder="Twilio number (E.164, e.g. +18005551111)"
              value={value.twilioNumber}
              onChange={(e) => onChange({ ...value, twilioNumber: e.target.value })}
              className="w-full border p-2 rounded text-sm"
            />
            <input
              type="text"
              placeholder="Caller-ID allowlist (E.164, comma-separated)"
              value={value.callerAllowlist.join(", ")}
              onChange={(e) =>
                onChange({
                  ...value,
                  callerAllowlist: e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
              className="w-full border p-2 rounded text-sm"
            />
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]{4,}"
              placeholder="Fallback PIN (4+ digits, optional)"
              maxLength={8}
              value={value.pin ?? ""}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, "").slice(0, 8);
                onChange({ ...value, pin: digits || undefined });
              }}
              className="w-full border p-2 rounded text-sm"
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
