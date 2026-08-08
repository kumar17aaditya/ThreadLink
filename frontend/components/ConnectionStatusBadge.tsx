import type { ConnectionStatus } from "@/types/protocol";

const STATUS_LABELS: Record<ConnectionStatus, string> = {
  idle: "Not connected",
  connecting: "Connecting…",
  connected: "Connected",
  disconnected: "Disconnected",
  reconnecting: "Reconnecting…",
  failed: "Connection failed",
};

const STATUS_COLORS: Record<ConnectionStatus, string> = {
  idle: "bg-zinc-500",
  connecting: "bg-amber-400 animate-pulse",
  connected: "bg-emerald-400",
  disconnected: "bg-zinc-500",
  reconnecting: "bg-amber-400 animate-pulse",
  failed: "bg-red-400",
};

interface ConnectionStatusBadgeProps {
  status: ConnectionStatus;
  compact?: boolean;
}

export function ConnectionStatusBadge({
  status,
  compact = false,
}: ConnectionStatusBadgeProps) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={`h-2 w-2 rounded-full ${STATUS_COLORS[status]}`}
        aria-hidden
      />
      {!compact && (
        <span className="text-xs font-medium text-zinc-400">
          {STATUS_LABELS[status]}
        </span>
      )}
    </div>
  );
}

export function getConnectionStatusLabel(status: ConnectionStatus): string {
  return STATUS_LABELS[status];
}
