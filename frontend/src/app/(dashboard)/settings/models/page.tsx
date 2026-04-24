"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { Header } from "@/components/header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import {
  Sparkles,
  DollarSign,
  Crown,
  Wrench,
  Loader2,
  Check,
  Bot,
} from "lucide-react";

const PRESETS = [
  {
    key: "recommended",
    name: "Recommended",
    description: "Best balance of cost and quality",
    icon: Sparkles,
    highlight: true,
  },
  {
    key: "budget",
    name: "Budget",
    description: "Lower cost, fewer reviewers",
    icon: DollarSign,
    highlight: false,
  },
  {
    key: "premium",
    name: "Premium",
    description: "Latest models, full review panels",
    icon: Crown,
    highlight: false,
  },
  {
    key: "custom",
    name: "Custom",
    description: "Pick models per agent",
    icon: Wrench,
    highlight: false,
  },
];

const AGENT_DISPLAY_NAMES: Record<string, string> = {
  meeting_brain: "Meeting Brain",
  ba_agent: "BA Agent",
  dev_agent: "Dev Agent",
  qa_agent: "QA Agent",
  memory_optimizer: "Memory Optimizer",
  supervisor: "Supervisor",
};

const AGENT_ORDER = [
  "meeting_brain",
  "ba_agent",
  "dev_agent",
  "qa_agent",
  "memory_optimizer",
  "supervisor",
];

interface AgentConfig {
  agentType: string;
  preset: string;
  primaryModelId: string;
  reviewerModelIds: string;
  maxSteps: number;
  confidenceThreshold: number;
  isActive: boolean;
}

interface AvailableModel {
  id: string;
  modelId: string;
  displayName: string;
  costInput: number;
  costOutput: number;
  provider: { id: string; name: string };
}

function costLabel(costInput: number) {
  if (costInput <= 0.5) return { text: "$", color: "text-emerald" };
  if (costInput <= 3) return { text: "$$", color: "text-amber" };
  if (costInput <= 10) return { text: "$$$", color: "text-amber" };
  return { text: "$$$$", color: "text-rose" };
}

export default function ModelConfigPage() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState("recommended");
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [customAgentModels, setCustomAgentModels] = useState<Record<string, string>>({});

  const loadConfig = useCallback(async () => {
    try {
      const [configRes, modelsRes] = await Promise.all([
        api.getModelConfig(),
        api.getAvailableModels(),
      ]);

      if (configRes.data) {
        const agentConfigs = configRes.data.agents || [];
        setAgents(agentConfigs);

        const firstPreset = agentConfigs.length > 0 ? agentConfigs[0].preset : "recommended";
        setSelectedPreset(firstPreset || "recommended");

        const modelMap: Record<string, string> = {};
        for (const agent of agentConfigs) {
          modelMap[agent.agentType] = agent.primaryModelId;
        }
        setCustomAgentModels(modelMap);
      }

      if (modelsRes.data) {
        setAvailableModels(modelsRes.data.models || []);
      }
    } catch {
      toast.error("Failed to load configuration", "Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  function handleCustomModelChange(agentType: string, modelId: string) {
    setCustomAgentModels((prev) => ({ ...prev, [agentType]: modelId }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const agentsToUpdate = selectedPreset === "custom"
        ? Object.entries(customAgentModels).map(([agentType, primaryModelId]) => ({
            agentType,
            primaryModelId,
            preset: "custom" as const,
          }))
        : agents.map((agent) => ({
            agentType: agent.agentType,
            primaryModelId: agent.primaryModelId,
            preset: selectedPreset,
          }));

      await Promise.all(
        agentsToUpdate.map((agent) =>
          api.updateModelConfig({
            agentType: agent.agentType,
            primaryModelId: agent.primaryModelId,
            preset: agent.preset,
          })
        )
      );

      toast.success("Configuration saved", "Your AI model settings have been updated.");
      await loadConfig();
    } catch (err) {
      toast.error("Failed to save", (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const sortedAgents = [...agents].sort((a, b) => {
    const aIdx = AGENT_ORDER.indexOf(a.agentType);
    const bIdx = AGENT_ORDER.indexOf(b.agentType);
    return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
  });

  if (loading) {
    return (
      <div className="min-h-screen">
        <Header title="Model Configuration" />
        <div className="p-6 lg:p-8 max-w-5xl space-y-4">
          <div className="skeleton h-10 w-80" />
          <div className="grid grid-cols-2 gap-4">
            <div className="skeleton h-28" />
            <div className="skeleton h-28" />
            <div className="skeleton h-28" />
            <div className="skeleton h-28" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Header title="Model Configuration" />

      <div className="max-w-5xl p-6 lg:p-8">
        <div className="mb-8 space-y-2">
          <h2 className="font-display text-3xl font-semibold tracking-[-0.025em] text-ink">
            AI Model Settings
          </h2>
          <p className="max-w-[58ch] text-sm text-ink-secondary">
            Choose how your AI team operates. Presets make it easy, or
            customize each agent individually.
          </p>
        </div>

        {/* Preset Cards */}
        <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PRESETS.map((preset) => {
            const isSelected = selectedPreset === preset.key;
            return (
              <button
                key={preset.key}
                onClick={() => setSelectedPreset(preset.key)}
                className={cn(
                  "card-interactive relative flex cursor-pointer flex-col items-start rounded-[var(--radius-lg)] border p-4 text-left shadow-[var(--shadow-card)] transition-all duration-[160ms]",
                  isSelected
                    ? "border-transparent border-gradient bg-accent-subtle"
                    : "border-border bg-surface hover:border-border-strong",
                )}
                aria-pressed={isSelected}
              >
                {isSelected && (
                  <div className="absolute right-3 top-3">
                    <Check className="h-4 w-4 text-accent" />
                  </div>
                )}
                <div
                  className={cn(
                    "mb-3 flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)]",
                    isSelected
                      ? "bg-accent text-white shadow-[0_0_14px_var(--color-accent-glow)]"
                      : "bg-surface-sunken text-ink-secondary",
                  )}
                >
                  <preset.icon className="h-[18px] w-[18px]" />
                </div>
                <span className="text-sm font-semibold text-ink">
                  {preset.name}
                </span>
                <span className="mt-0.5 text-xs text-ink-tertiary">
                  {preset.description}
                </span>
                {preset.highlight && !isSelected && (
                  <Badge variant="info" className="mt-2 text-[10px]">
                    Default
                  </Badge>
                )}
              </button>
            );
          })}
        </div>

        {/* Custom Agent Configuration */}
        {selectedPreset === "custom" && (
          <Card className="mb-8 animate-fade-in">
            <CardHeader>
              <CardTitle className="text-base">Per-Agent Models</CardTitle>
              <CardDescription>
                Select which AI model each agent uses. Higher-tier models cost more but produce better results.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="grid grid-cols-12 gap-4 text-xs font-medium text-ink-tertiary uppercase tracking-wider pb-2 border-b border-ink/[0.04]">
                  <div className="col-span-3">Agent</div>
                  <div className="col-span-5">Primary Model</div>
                  <div className="col-span-2">Reviewers</div>
                  <div className="col-span-2 text-right">Cost</div>
                </div>

                {sortedAgents.map((agent) => {
                  const currentModel = availableModels.find((m) => m.id === agent.primaryModelId);
                  const cost = costLabel(currentModel?.costInput ?? 0);
                  const displayName = AGENT_DISPLAY_NAMES[agent.agentType] || agent.agentType;
                  const reviewerIds: string[] = (() => {
                    try { return JSON.parse(agent.reviewerModelIds as unknown as string) as string[]; } catch { return []; }
                  })();

                  return (
                    <div
                      key={agent.agentType}
                      className="grid grid-cols-12 gap-4 items-center py-2"
                    >
                      <div className="col-span-3 flex items-center gap-2.5">
                        <div className="flex items-center justify-center w-8 h-8 rounded-xl bg-surface-sunken">
                          <Bot className="w-4 h-4 text-ink-tertiary" />
                        </div>
                        <span className="text-sm font-medium text-ink">{displayName}</span>
                      </div>

                      <div className="col-span-5">
                        <Select
                          value={customAgentModels[agent.agentType] || agent.primaryModelId}
                          onValueChange={(val) => handleCustomModelChange(agent.agentType, val)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select model" />
                          </SelectTrigger>
                          <SelectContent>
                            {availableModels.map((model) => (
                              <SelectItem key={model.id} value={model.id}>
                                {model.displayName}
                                <span className="text-ink-faint ml-1">({model.provider.name})</span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="col-span-2">
                        <span className="text-sm text-ink-tertiary">
                          {reviewerIds.length > 0
                            ? `${reviewerIds.length} reviewer${reviewerIds.length > 1 ? "s" : ""}`
                            : "None"}
                        </span>
                      </div>

                      <div className="col-span-2 text-right">
                        <span className={cn("text-sm font-semibold", cost.color)}>
                          {cost.text}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Non-custom: show current config summary */}
        {selectedPreset !== "custom" && sortedAgents.length > 0 && (
          <Card className="mb-8">
            <CardHeader>
              <CardTitle className="font-display text-base font-semibold tracking-[-0.02em]">
                Current Configuration
              </CardTitle>
              <CardDescription>
                These models are automatically assigned based on the selected
                preset.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="divide-y divide-border">
                {sortedAgents.map((agent) => {
                  const currentModel = availableModels.find(
                    (m) => m.id === agent.primaryModelId,
                  );
                  const cost = costLabel(currentModel?.costInput ?? 0);
                  const displayName =
                    AGENT_DISPLAY_NAMES[agent.agentType] || agent.agentType;
                  const modelLabel =
                    currentModel?.displayName || agent.primaryModelId;

                  return (
                    <li
                      key={agent.agentType}
                      className="flex items-center justify-between py-3 first:pt-0 last:pb-0"
                    >
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] bg-surface-sunken">
                          <Bot className="h-4 w-4 text-ink-tertiary" />
                        </div>
                        <div className="flex items-baseline gap-2">
                          <span className="text-sm font-medium text-ink">
                            {displayName}
                          </span>
                          <span className="font-mono text-[11px] text-ink-tertiary">
                            {modelLabel}
                          </span>
                        </div>
                      </div>
                      <span
                        className={cn(
                          "font-mono text-sm font-semibold tabular",
                          cost.color,
                        )}
                      >
                        {cost.text}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Save button */}
        <div className="flex items-center justify-end">
          <Button
            variant="accent"
            className="glow"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              "Save Configuration"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
