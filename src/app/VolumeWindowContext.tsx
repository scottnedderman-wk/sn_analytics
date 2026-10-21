import { createContext, useContext, useState, type ReactNode } from "react";
import { canApplyWindow, DEFAULT_VOLUME_WINDOW, type DayWindow } from "@/lib/volumeWindow";

type VolumeWindowValue = {
  draft: DayWindow;
  applied: DayWindow;
  setDraft: (next: DayWindow) => void;
  apply: () => void;
};

const VolumeWindowContext = createContext<VolumeWindowValue | null>(null);

export function VolumeWindowProvider({ children }: { children: ReactNode }) {
  const [applied, setApplied] = useState<DayWindow>(DEFAULT_VOLUME_WINDOW);
  const [draft, setDraft] = useState<DayWindow>(DEFAULT_VOLUME_WINDOW);

  function apply() {
    if (!canApplyWindow(draft, applied)) return;
    setApplied(draft);
  }

  return (
    <VolumeWindowContext.Provider value={{ draft, applied, setDraft, apply }}>
      {children}
    </VolumeWindowContext.Provider>
  );
}

export function useVolumeWindow(): VolumeWindowValue {
  const ctx = useContext(VolumeWindowContext);
  if (!ctx) throw new Error("useVolumeWindow requires VolumeWindowProvider");
  return ctx;
}
