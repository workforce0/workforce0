import { Badge } from "./ui/badge";

const statusConfig: Record<string, { label: string; variant: "default" | "success" | "warning" | "error" | "info" | "purple" }> = {
  scheduled: { label: "Scheduled", variant: "info" },
  joining: { label: "Joining", variant: "info" },
  in_progress: { label: "In Progress", variant: "purple" },
  transcribing: { label: "Transcribing", variant: "purple" },
  processing: { label: "Processing", variant: "warning" },
  completed: { label: "Completed", variant: "success" },
  failed: { label: "Failed", variant: "error" },
  cancelled: { label: "Cancelled", variant: "default" },
  draft: { label: "Draft", variant: "default" },
  review: { label: "Needs Review", variant: "warning" },
  pending_approval: { label: "Pending", variant: "warning" },
  approved: { label: "Approved", variant: "success" },
  rejected: { label: "Rejected", variant: "error" },
  needs_clarification: { label: "Needs Input", variant: "purple" },
  pending: { label: "Pending", variant: "default" },
  awaiting_clarification: { label: "Needs Input", variant: "purple" },
  awaiting_approval: { label: "Pending", variant: "warning" },
  created: { label: "Created", variant: "info" },
  synced: { label: "Synced", variant: "success" },
  done: { label: "Done", variant: "success" },
  dispatched: { label: "Dispatched", variant: "info" },
};

export function StatusBadge({ status }: { status: string }) {
  const config = statusConfig[status] || { label: status, variant: "default" as const };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}
