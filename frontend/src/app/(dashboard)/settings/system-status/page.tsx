"use client";
import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";

interface Status {
  service: string;
  status: "up" | "down" | "disabled";
  latencyMs: number | null;
  lastError: string | null;
}

export default function SystemStatusPage() {
  const [rows, setRows] = useState<Status[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const tick = () =>
      fetch("/api/integrations/status", { credentials: "include" })
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((j: { data: Status[] }) => {
          setRows(j.data);
          setError(null);
        })
        .catch((e: Error) => setError(e.message));
    tick();
    const id = setInterval(tick, 10_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="space-y-4 p-6">
      <h1 className="text-2xl font-bold">System Status</h1>
      <p className="text-sm text-ink-tertiary">
        Health of bundled services. Polls every 10 seconds.
      </p>
      {error && (
        <div className="text-rose text-sm">
          Failed to load status: {error}. Retrying every 10s.
        </div>
      )}
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b">
              <tr>
                <th className="text-left p-3">Service</th>
                <th className="text-left p-3">Status</th>
                <th className="text-left p-3">Latency</th>
                <th className="text-left p-3">Last error</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.service} className="border-b last:border-0">
                  <td className="p-3 font-mono">{r.service}</td>
                  <td className="p-3">
                    <span
                      className={`inline-block w-2 h-2 rounded-full mr-2 ${
                        r.status === "up"
                          ? "bg-emerald"
                          : r.status === "down"
                            ? "bg-rose"
                            : "bg-slate-400"
                      }`}
                    />
                    {r.status}
                  </td>
                  <td className="p-3">{r.latencyMs !== null ? `${r.latencyMs}ms` : "—"}</td>
                  <td className="p-3 text-rose">{r.lastError ?? "—"}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-3 text-center text-ink-tertiary">
                    Loading…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
