import { cn } from "@/lib/utils";

interface GridBackgroundProps {
  className?: string;
}

export function GridBackground({ className }: GridBackgroundProps) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0",
        "[background-size:44px_44px] [background-image:linear-gradient(to_right,rgba(148,163,184,0.12)_1px,transparent_1px),linear-gradient(to_bottom,rgba(148,163,184,0.12)_1px,transparent_1px)]",
        "[mask-image:radial-gradient(ellipse_at_center,black_55%,transparent_100%)]",
        className
      )}
    />
  );
}
