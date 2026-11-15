import { create } from "zustand";
import { ChatMessage, ModelPreference, Mode, User } from "./types";

export type Theme = "light" | "dark";

export type AuthStatus = "loading" | "authenticated" | "anonymous";

interface UiState {
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  modelPreference: ModelPreference;
  setModelPreference: (m: ModelPreference) => void;
  activeMode: Mode;
  setActiveMode: (mode: Mode) => void;
  // Theme
  theme: Theme;
  initTheme: () => void;
  toggleTheme: () => void;
  setTheme: (t: Theme) => void;
  // Authentication: set only from verified server responses (see lib/auth.ts)
  user: User | null;
  isAuthenticated: boolean;
  authStatus: AuthStatus;
  setAuthUser: (user: User | null) => void;
  setAuthStatus: (status: AuthStatus) => void;
  // per-mode chat history
  chatHistories: Record<Mode, ChatMessage[]>;
  appendMessage: (mode: Mode, message: ChatMessage) => void;
  updateMessage: (mode: Mode, id: string, patch: Partial<ChatMessage>) => void;
  resetHistory: (mode: Mode, messages: ChatMessage[]) => void;
}

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  if (theme === "dark") {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }
  try {
    localStorage.setItem("cognexa-theme", theme);
  } catch {}
}

function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "light";
  try {
    const saved = localStorage.getItem("cognexa-theme");
    if (saved === "dark" || saved === "light") return saved;
  } catch {}
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export const useUiStore = create<UiState>((set, get) => ({
  sidebarOpen: true,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  modelPreference: "balanced",
  setModelPreference: (modelPreference) => set({ modelPreference }),
  activeMode: "research",
  setActiveMode: (mode) => set({ activeMode: mode }),

  // Theme — follows the system until the user picks one
  theme: "light",
  initTheme: () => {
    const t = getStoredTheme();
    applyTheme(t);
    set({ theme: t });
  },
  setTheme: (t) => { applyTheme(t); set({ theme: t }); },
  toggleTheme: () => {
    const next: Theme = get().theme === "light" ? "dark" : "light";
    applyTheme(next);
    set({ theme: next });
  },

  // Auth state: unknown until the session check in AppShell finishes
  user: null,
  isAuthenticated: false,
  authStatus: "loading",
  setAuthUser: (user) => set({ user, isAuthenticated: !!user, authStatus: user ? "authenticated" : "anonymous" }),
  setAuthStatus: (authStatus) => set({ authStatus }),

  chatHistories: { research: [], paper: [] },
  appendMessage: (mode, message) =>
    set((s) => ({
      chatHistories: { ...s.chatHistories, [mode]: [...s.chatHistories[mode], message] },
    })),
  updateMessage: (mode, id, patch) =>
    set((s) => ({
      chatHistories: {
        ...s.chatHistories,
        [mode]: s.chatHistories[mode].map((m) => (m.id === id ? { ...m, ...patch } : m)),
      },
    })),
  resetHistory: (mode, messages) =>
    set((s) => ({ chatHistories: { ...s.chatHistories, [mode]: messages } })),
}));
