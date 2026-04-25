"use client";
import { Card, CardContent } from "@/components/ui/card";

export type LocalTier = "light" | "default" | "heavy" | "none";

const TIERS: { id: LocalTier; label: string; disk: string; desc: string }[] = [
  { id: "none", label: "No local models", disk: "0 GB", desc: "BYOK only — bring an Anthropic / OpenAI / Google key" },
  { id: "light", label: "Light", disk: "~5 GB", desc: "Qwen 3.5 8B — works on 16 GB RAM" },
  { id: "default", label: "Default", disk: "~14 GB", desc: "Mistral Small 3 24B reasoning + Qwen 3.5 8B extraction" },
  { id: "heavy", label: "Heavy", disk: "~25 GB", desc: "Qwen 3.5 32B + 8B parallel — needs 48 GB+ RAM" },
];

export function LocalModelsToggle({
  value,
  onChange,
  recommended,
}: {
  value: LocalTier;
  onChange: (v: LocalTier) => void;
  recommended: LocalTier;
}) {
  return (
    <Card>
      <CardContent className="space-y-3 p-6">
        <h3 className="text-lg font-semibold">Local models</h3>
        <p className="text-sm text-ink-tertiary">
          Run open-weights models locally. Recommended for your hardware: <strong>{recommended}</strong>.
        </p>
        <div className="space-y-2">
          {TIERS.map((t) => (
            <label
              key={t.id}
              className={`block p-3 rounded border cursor-pointer ${
                value === t.id ? "border-violet bg-violet-light/20" : "border-border hover:bg-surface-sunken"
              }`}
            >
              <input
                type="radio"
                name="local-tier"
                className="mr-2"
                checked={value === t.id}
                onChange={() => onChange(t.id)}
              />
              <strong>{t.label}</strong> · <span className="text-ink-tertiary">{t.disk}</span>
              <div className="text-sm text-ink-tertiary mt-1">{t.desc}</div>
            </label>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
