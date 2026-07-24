"use client";

// Day-of-week (rows) x hour-of-day (cols) usage heatmap — hand-rolled CSS grid,
// no charting dep. Mongo $dayOfWeek is 1=Sunday..7=Saturday.
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const GRID = { display: "grid", gridTemplateColumns: "repeat(24, minmax(0, 1fr))" };

export function ActivityHeatmap({
  data,
}: {
  data: { dow: number; hour: number; count: number }[];
}) {
  const map = new Map<string, number>();
  let max = 0;
  for (const cell of data) {
    map.set(`${cell.dow}-${cell.hour}`, cell.count);
    if (cell.count > max) max = cell.count;
  }

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[600px]">
        <div className="flex items-end pb-1">
          <div className="w-10 shrink-0" />
          <div className="flex-1 gap-1" style={GRID}>
            {HOURS.map((h) => (
              <div
                key={h}
                className="text-center text-[11px] text-slate-400 dark:text-slate-500"
              >
                {h % 6 === 0 ? h : ""}
              </div>
            ))}
          </div>
        </div>
        {DAYS.map((day, index) => {
          const dow = index + 1;
          return (
            <div key={day} className="mt-1 flex items-center">
              <div className="w-10 shrink-0 text-[11px] text-slate-500 dark:text-slate-400">
                {day}
              </div>
              <div className="flex-1 gap-1" style={GRID}>
                {HOURS.map((h) => {
                  const count = map.get(`${dow}-${h}`) ?? 0;
                  const t = max === 0 ? 0 : count / max;
                  return (
                    <div
                      key={h}
                      title={`${day} ${String(h).padStart(2, "0")}:00 — ${count} event${count === 1 ? "" : "s"}`}
                      className="aspect-square rounded-[3px] transition-transform duration-150 hover:scale-[1.35]"
                      style={
                        t === 0
                          ? undefined
                          : { backgroundColor: `hsl(var(--chart-2) / ${(0.15 + t * 0.85).toFixed(3)})` }
                      }
                    >
                      {t === 0 ? (
                        <div className="h-full w-full rounded-[3px] bg-slate-100 dark:bg-slate-800" />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
