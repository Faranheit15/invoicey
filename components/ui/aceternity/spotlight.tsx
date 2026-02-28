import { cn } from "@/lib/utils";

interface SpotlightProps {
  className?: string;
  fill?: string;
}

export function Spotlight({ className, fill = "#60A5FA" }: SpotlightProps) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute rounded-full blur-3xl",
        className
      )}
      style={{
        background: `radial-gradient(circle at center, ${fill} 0%, transparent 65%)`,
      }}
    />
  );
}
