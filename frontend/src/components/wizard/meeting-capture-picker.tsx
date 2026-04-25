"use client";
import { Card, CardContent } from "@/components/ui/card";

export type MeetingBotChoice = "vexa" | "recall" | "skip";

const CHOICES: { id: MeetingBotChoice; label: string; pros: string[]; cons: string[] }[] = [
  {
    id: "vexa",
    label: "Bundled (Vexa)",
    pros: ["No external account", "Apache 2.0", "Audio stays on host"],
    cons: ["Adds ~310 MB RAM"],
  },
  {
    id: "recall",
    label: "Recall.ai (BYOK)",
    pros: ["Most reliable joins", "Vendor-managed"],
    cons: ["~$0.50/hour", "Audio leaves your network"],
  },
  {
    id: "skip",
    label: "Skip (manual upload only)",
    pros: ["Always works"],
    cons: ["No live capture"],
  },
];

export function MeetingCapturePicker({
  value,
  onChange,
  onRecallKey,
}: {
  value: MeetingBotChoice;
  onChange: (v: MeetingBotChoice) => void;
  onRecallKey: (k: string) => void;
}) {
  return (
    <Card>
      <CardContent className="space-y-3 p-6">
        <h3 className="text-lg font-semibold">Meeting capture</h3>
        <div className="grid md:grid-cols-3 gap-3">
          {CHOICES.map((c) => (
            <label
              key={c.id}
              className={`block p-3 rounded border cursor-pointer ${
                value === c.id ? "border-violet bg-violet-light/20" : "border-border hover:bg-surface-sunken"
              }`}
            >
              <input
                type="radio"
                name="meeting-bot"
                className="mb-2"
                checked={value === c.id}
                onChange={() => onChange(c.id)}
              />
              <strong>{c.label}</strong>
              <ul className="text-xs mt-2 space-y-1">
                {c.pros.map((p) => (
                  <li key={p} className="text-emerald">
                    ✓ {p}
                  </li>
                ))}
                {c.cons.map((p) => (
                  <li key={p} className="text-amber">
                    ⚠ {p}
                  </li>
                ))}
              </ul>
            </label>
          ))}
        </div>
        {value === "recall" && (
          <input
            type="password"
            placeholder="Recall.ai API key"
            className="w-full border p-2 rounded text-sm"
            onChange={(e) => onRecallKey(e.target.value)}
          />
        )}
      </CardContent>
    </Card>
  );
}
