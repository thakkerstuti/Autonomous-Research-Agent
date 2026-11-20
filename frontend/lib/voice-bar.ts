/**
 * The voice bar: while CogNexa talks with the user, the message bar becomes the voice (moving sound
 * lines). Whoever is talking (a research turn's questions, or its spoken feedback) claims the bar;
 * the page shows it in place of the message box. One owner at a time.
 */
import { create } from "zustand";

export type BarMode = "speaking" | "listening" | "idle";
export interface BarControls {
  skip?: () => void;
  pause?: () => void;
  off?: () => void;
  feedback?: () => void;
  start?: () => void; // the browser refused to speak until the page is clicked
  stop?: () => void;
}

interface VoiceBarState {
  owner: string | null;
  mode: BarMode;
  controls: BarControls;
  /** Increases with each spoken or heard word; the lines flare when it changes. */
  pulse: { n: number; strength: number };
  claim: (owner: string, controls: BarControls) => void;
  release: (owner: string) => void;
  setMode: (owner: string, mode: BarMode) => void;
  flare: (owner: string, strength?: number) => void;
}

export const useVoiceBar = create<VoiceBarState>((set, get) => ({
  owner: null,
  mode: "idle",
  controls: {},
  pulse: { n: 0, strength: 0 },
  claim: (owner, controls) => {
    const s = get();
    if (s.owner === owner) set({ controls });
    else set({ owner, controls, mode: "idle" });
  },
  release: (owner) => {
    if (get().owner === owner) set({ owner: null, controls: {}, mode: "idle" });
  },
  setMode: (owner, mode) => {
    if (get().owner === owner) set({ mode });
  },
  flare: (owner, strength = 0.6) => {
    const s = get();
    if (s.owner === owner) set({ pulse: { n: s.pulse.n + 1, strength } });
  },
}));
