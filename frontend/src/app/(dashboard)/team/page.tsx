"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { Header } from "@/components/header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import {
  UserPlus,
  Pencil,
  Trash2,
  Loader2,
  Users,
  Mail,
  MessageSquare,
  Send,
  Hash,
  Phone,
} from "lucide-react";

const ROLES = [
  { value: "founder", label: "Founder" },
  { value: "cto", label: "CTO" },
  { value: "pm", label: "PM" },
  { value: "developer", label: "Developer" },
  { value: "designer", label: "Designer" },
  { value: "qa", label: "QA" },
];

const CHANNELS = [
  { value: "slack", label: "Slack" },
  { value: "email", label: "Email" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "teams", label: "Teams" },
  { value: "sms", label: "SMS" },
];

function roleBadgeVariant(role: string): "default" | "info" | "purple" | "success" | "warning" | "error" {
  switch (role.toLowerCase()) {
    case "founder":
      return "purple";
    case "cto":
      return "info";
    case "pm":
      return "success";
    case "developer":
      return "default";
    case "designer":
      return "warning";
    case "qa":
      return "error";
    default:
      return "default";
  }
}

function channelIcon(channel: string) {
  switch (channel.toLowerCase()) {
    case "email":
      return Mail;
    case "slack":
      return Hash;
    case "sms":
    case "whatsapp":
      return Phone;
    default:
      return MessageSquare;
  }
}

const CHANNEL_ADDRESS_SPEC: Record<string, { label: string; placeholder: string; helper: string }> = {
  email:    { label: "Email address",    placeholder: "name@company.com",   helper: "" },
  slack:    { label: "Slack member ID",  placeholder: "U12345ABC",          helper: "In Slack → profile → More → Copy member ID." },
  whatsapp: { label: "WhatsApp number",  placeholder: "+14155551234",       helper: "Include country code." },
  teams:    { label: "Teams email / UPN",placeholder: "name@company.com",   helper: "Same as their Microsoft 365 login." },
  sms:      { label: "Phone number",     placeholder: "+14155551234",       helper: "Include country code." },
};

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  preferredChannel: string;
  channelIds?: Record<string, string>;
  createdAt: string;
}

interface MemberForm {
  name: string;
  email: string;
  role: string;
  preferredChannel: string;
  channelIds: Record<string, string>;
}

const EMPTY_FORM: MemberForm = {
  name: "",
  email: "",
  role: "developer",
  preferredChannel: "email",
  channelIds: {},
};

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n.charAt(0))
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export default function TeamPage() {
  const toast = useToast();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<MemberForm>(EMPTY_FORM);

  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);

  const loadTeam = useCallback(async () => {
    try {
      const res = await api.getTeam();
      setMembers(res.data || []);
    } catch {
      toast.error("Failed to load team", "Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTeam();
  }, [loadTeam]);

  function openAddDialog() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }

  function openEditDialog(member: TeamMember) {
    setEditingId(member.id);
    setForm({
      name: member.name,
      email: member.email,
      role: member.role,
      preferredChannel: member.preferredChannel,
      channelIds: { ...(member.channelIds ?? {}) },
    });
    setDialogOpen(true);
  }

  async function handleSubmit() {
    if (!form.name.trim() || !form.email.trim()) {
      toast.warning("Missing fields", "Please enter a name and email.");
      return;
    }

    // Default the preferred channel's address to the email field if it's still blank
    const channelIds = { ...form.channelIds };
    if (!channelIds.email) channelIds.email = form.email;
    if (form.preferredChannel !== "email" && !channelIds[form.preferredChannel]) {
      toast.warning(
        "Missing channel address",
        `Enter a ${form.preferredChannel} address, or switch preferred channel to email.`,
      );
      return;
    }

    setSaving(true);
    try {
      if (editingId) {
        await api.updateTeamMember(editingId, {
          name: form.name,
          role: form.role,
          preferredChannel: form.preferredChannel,
          channelIds,
        });
        toast.success("Member updated");
      } else {
        await api.addTeamMember({ ...form, channelIds });
        toast.success("Member added", `${form.name} has been added to the team.`);
      }
      setDialogOpen(false);
      await loadTeam();
    } catch (err) {
      toast.error("Failed to save", (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleTest(memberId: string) {
    setTestingId(memberId);
    try {
      const res = await api.testMemberChannel(memberId);
      if (res.success) {
        toast.success("Test sent", `Delivered via ${res.data?.channel ?? "their preferred channel"}.`);
      } else {
        toast.error(
          "Couldn't deliver test message",
          res.error?.message ?? "Check the channel address and try again.",
        );
      }
    } catch (err) {
      toast.error("Test failed", (err as Error).message);
    } finally {
      setTestingId(null);
    }
  }

  async function handleDelete(id: string) {
    setDeleting(true);
    try {
      await api.removeTeamMember(id);
      toast.success("Member removed");
      setDeleteConfirm(null);
      await loadTeam();
    } catch (err) {
      toast.error("Failed to remove", (err as Error).message);
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen">
        <Header title="Team" />
        <div className="p-6 lg:p-8 max-w-5xl space-y-4">
          <div className="skeleton h-10 w-80" />
          <div className="skeleton h-20" />
          <div className="skeleton h-20" />
          <div className="skeleton h-20" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Header title="Team" />

      <div className="max-w-5xl space-y-8 p-6 lg:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <h2 className="font-display text-3xl font-semibold tracking-[-0.025em] text-ink">
              Team Roster
            </h2>
            <p className="max-w-[58ch] text-sm text-ink-secondary">
              Manage who receives updates and how your AI team communicates
              with them.
            </p>
          </div>
          <Button variant="accent" className="glow" onClick={openAddDialog}>
            <UserPlus className="h-4 w-4" />
            Add Member
          </Button>
        </div>

        {members.length === 0 ? (
          <Card className="glass-strong">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-[var(--radius-lg)] bg-accent-subtle">
                <Users className="h-7 w-7 text-accent" />
              </div>
              <h3 className="font-display text-xl font-semibold tracking-[-0.025em] text-ink">
                Add your first team member
              </h3>
              <p className="mt-1 max-w-sm text-sm text-ink-secondary">
                Team members receive project updates, clarification requests,
                and approval notifications.
              </p>
              <Button
                variant="accent"
                className="glow mt-4"
                onClick={openAddDialog}
              >
                <UserPlus className="h-4 w-4" />
                Add Member
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {members.map((member) => {
              const ChannelIcon = channelIcon(member.preferredChannel);
              const channelLabel =
                CHANNELS.find((c) => c.value === member.preferredChannel)
                  ?.label || member.preferredChannel;
              const roleLabel =
                ROLES.find((r) => r.value === member.role)?.label ||
                member.role;

              return (
                <div
                  key={member.id}
                  className={cn(
                    "glass flex flex-wrap items-center gap-4 rounded-[var(--radius-md)] border border-border bg-surface p-4 shadow-[var(--shadow-card)] transition-all duration-[160ms] hover:border-border-strong sm:flex-nowrap",
                  )}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-gradient-to-br from-ink to-ink-secondary text-xs font-semibold text-ink-inverse">
                      {getInitials(member.name)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold text-ink">
                          {member.name}
                        </span>
                        <Badge variant={roleBadgeVariant(member.role)}>
                          {roleLabel}
                        </Badge>
                      </div>
                      <span className="block truncate font-mono text-[11px] text-ink-tertiary">
                        {member.email}
                      </span>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5 rounded-full bg-surface-sunken px-2.5 py-1 text-xs text-ink-secondary">
                    <ChannelIcon className="h-3.5 w-3.5 text-accent" />
                    <span className="font-medium">{channelLabel}</span>
                  </div>

                  <div className="ml-auto flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => handleTest(member.id)}
                      disabled={testingId === member.id}
                      className="rounded-[var(--radius-sm)] p-1.5 text-ink-tertiary transition-colors hover:bg-surface-sunken hover:text-ink disabled:opacity-50"
                      aria-label={`Send test message to ${member.name}`}
                      title="Send test message"
                    >
                      {testingId === member.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Send className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <button
                      onClick={() => openEditDialog(member)}
                      className="rounded-[var(--radius-sm)] p-1.5 text-ink-tertiary transition-colors hover:bg-surface-sunken hover:text-ink"
                      aria-label={`Edit ${member.name}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(member.id)}
                      className="rounded-[var(--radius-sm)] p-1.5 text-ink-tertiary transition-colors hover:bg-rose-light hover:text-rose"
                      aria-label={`Remove ${member.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Team Member" : "Add Team Member"}</DialogTitle>
            <DialogDescription>
              {editingId
                ? "Update this team member's information."
                : "Add someone to your team so they can receive updates and notifications."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="member-name">Name</Label>
              <Input
                id="member-name"
                placeholder="Full name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="member-email">Email</Label>
              <Input
                id="member-email"
                type="email"
                placeholder="name@company.com"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Role</Label>
                <Select
                  value={form.role}
                  onValueChange={(val) => setForm((f) => ({ ...f, role: val }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((role) => (
                      <SelectItem key={role.value} value={role.value}>
                        {role.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Preferred Channel</Label>
                <Select
                  value={form.preferredChannel}
                  onValueChange={(val) => setForm((f) => ({ ...f, preferredChannel: val }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select channel" />
                  </SelectTrigger>
                  <SelectContent>
                    {CHANNELS.map((ch) => (
                      <SelectItem key={ch.value} value={ch.value}>
                        {ch.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {form.preferredChannel !== "email" && (
              <div className="space-y-1.5">
                <Label htmlFor="channel-address">
                  {CHANNEL_ADDRESS_SPEC[form.preferredChannel]?.label ?? "Channel address"}
                </Label>
                <Input
                  id="channel-address"
                  placeholder={CHANNEL_ADDRESS_SPEC[form.preferredChannel]?.placeholder}
                  value={form.channelIds[form.preferredChannel] ?? ""}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      channelIds: { ...f.channelIds, [f.preferredChannel]: e.target.value },
                    }))
                  }
                />
                {CHANNEL_ADDRESS_SPEC[form.preferredChannel]?.helper && (
                  <p className="text-xs text-ink-tertiary">
                    {CHANNEL_ADDRESS_SPEC[form.preferredChannel]!.helper}
                  </p>
                )}
              </div>
            )}

            <details className="text-sm">
              <summary className="cursor-pointer text-ink-tertiary hover:text-ink">
                Backup channels (optional)
              </summary>
              <div className="mt-3 space-y-3">
                {CHANNELS.filter((c) => c.value !== form.preferredChannel).map((ch) => (
                  <div key={ch.value} className="space-y-1">
                    <Label className="text-xs">
                      {ch.label} — {CHANNEL_ADDRESS_SPEC[ch.value]?.label}
                    </Label>
                    <Input
                      placeholder={CHANNEL_ADDRESS_SPEC[ch.value]?.placeholder}
                      value={form.channelIds[ch.value] ?? ""}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          channelIds: { ...f.channelIds, [ch.value]: e.target.value },
                        }))
                      }
                    />
                  </div>
                ))}
                <p className="text-xs text-ink-tertiary">
                  If the preferred channel fails, Workforce0 tries these in order.
                </p>
              </div>
            </details>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving...
                </>
              ) : editingId ? (
                "Save Changes"
              ) : (
                "Add Member"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Team Member</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove this person from the team? They will no longer receive notifications or updates.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirm && handleDelete(deleteConfirm)}
              disabled={deleting}
            >
              {deleting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Removing...
                </>
              ) : (
                "Remove Member"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
