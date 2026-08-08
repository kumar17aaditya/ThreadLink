import type { Presence } from "@/types/protocol";

const PRESENCE_COLOR: Record<Presence, string> = {
  online: "bg-emerald-400",
  away: "bg-amber-400",
  offline: "bg-zinc-600",
};

interface PresenceDotProps {
  presence: Presence;
  className?: string;
}

export function PresenceDot({ presence, className = "" }: PresenceDotProps) {
  return (
    <span
      className={`block h-2.5 w-2.5 rounded-full ring-2 ring-[#0a0a0b] ${PRESENCE_COLOR[presence]} ${className}`}
      aria-label={`Presence: ${presence}`}
      title={presence}
    />
  );
}
