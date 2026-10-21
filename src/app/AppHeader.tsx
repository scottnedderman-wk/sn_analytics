import { ThemeToggle } from "@/components/ui";
import { canApplyWindow } from "@/lib/volumeWindow";
import { useVolumeWindow } from "./VolumeWindowContext";

export function AppHeader({
  theme,
  onToggleTheme,
}: {
  theme: "light" | "dark";
  onToggleTheme: () => void;
}) {
  const { draft, applied, setDraft, apply } = useVolumeWindow();
  const canApply = canApplyWindow(draft, applied);

  return (
    <div className="flex flex-wrap items-center justify-end gap-2 shrink-0 mb-1">
      <label className="flex items-center gap-1.5 text-[12px] txt-2">
        <span className="whitespace-nowrap">Start</span>
        <input
          type="date"
          aria-label="Window start date"
          value={draft.start}
          max={draft.end || undefined}
          onChange={(e) => setDraft({ ...draft, start: e.target.value })}
          className="surf border rounded-md px-2 py-1.5 text-[12px] font-medium outline-none focus:ring-2 focus:ring-blue-500/40"
        />
      </label>
      <label className="flex items-center gap-1.5 text-[12px] txt-2">
        <span className="whitespace-nowrap">End</span>
        <input
          type="date"
          aria-label="Window end date"
          value={draft.end}
          min={draft.start || undefined}
          onChange={(e) => setDraft({ ...draft, end: e.target.value })}
          className="surf border rounded-md px-2 py-1.5 text-[12px] font-medium outline-none focus:ring-2 focus:ring-blue-500/40"
        />
      </label>
      <button
        type="button"
        aria-label="Apply date window"
        disabled={!canApply}
        onClick={apply}
        className="surf border rounded-md px-2.5 py-1.5 text-[12px] font-medium hover:opacity-80 disabled:opacity-40"
      >
        Apply
      </button>
      <ThemeToggle theme={theme} onToggle={onToggleTheme} />
    </div>
  );
}
