import { GridBackground } from "@/components/ui/aceternity/grid-background";
import { Spotlight } from "@/components/ui/aceternity/spotlight";
import { cn } from "@/lib/utils";

/**
 * The marketing register's background light.
 *
 * Five surfaces composed this by hand — a sky spotlight bled off the top centre,
 * an orange counterweight in a bottom corner, and a masked grid at 70% — and the
 * numbers drifted for no reason anyone could name: sky opacity ran 0.55 / 0.58 /
 * 0.60, its diameter 28 / 30 / 34rem, the orange 22 / 24rem at 0.35 / 0.40.
 * Those were transcription noise, not design decisions, so they are settled here.
 *
 * This is also where DESIGN.md's Atmosphere-Not-Object Rule becomes enforceable:
 * sky and orange exist as light behind content and nowhere else. A surface that
 * wants brand colour reaches for this, not for a tinted button.
 */
interface AtmosphereProps {
  /** Which bottom corner the orange counterweight occupies. */
  counterweight?: "left" | "right";
  /** Adds the third sky glow the landing hero uses to fill a taller viewport. */
  extended?: boolean;
  className?: string;
}

export function Atmosphere({
  counterweight = "left",
  extended = false,
  className,
}: AtmosphereProps) {
  return (
    <div className={cn("pointer-events-none absolute inset-0", className)} aria-hidden="true">
      <Spotlight
        className={cn(
          "left-1/2 -translate-x-1/2 opacity-60",
          extended ? "-top-48 h-[34rem] w-[34rem]" : "-top-40 h-[30rem] w-[30rem]"
        )}
        fill="#0EA5E9"
      />
      {/* On the tall landing hero the orange sits mid-left, beside the copy
          column, rather than in a bottom corner. That placement is a
          composition decision, not the transcription noise the sizes were, so
          it survives the consolidation. */}
      <Spotlight
        className={cn(
          extended
            ? "-left-32 top-56 h-[24rem] w-[24rem] opacity-40"
            : cn(
                "bottom-6 h-[22rem] w-[22rem] opacity-35",
                counterweight === "left" ? "-left-24" : "-right-24"
              )
        )}
        fill="#F97316"
      />
      {extended ? (
        <Spotlight
          className="-right-32 bottom-20 h-[26rem] w-[26rem] opacity-35"
          fill="#38BDF8"
        />
      ) : null}
      <GridBackground className="opacity-70" />
    </div>
  );
}
