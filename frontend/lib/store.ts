import { create } from "zustand";
import { ChatMessage, ModelPreference, Mode, User } from "./types";

export type Theme = "light" | "dark";

const MOCK_DEFAULT_USER: User = {
  id: "usr_1",
  name: "Dr. Alex Morgan",
  email: "alex.morgan@cognexa.ai",
  role: "Lead Researcher",
  institution: "Stanford AI Lab",
  avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&q=80",
};

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
  // User Authentication
  user: User | null;
  isAuthenticated: boolean;
  login: (userData: Partial<User>) => void;
  logout: () => void;
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
  return "light";
}

export const useUiStore = create<UiState>((set, get) => ({
  sidebarOpen: true,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  modelPreference: "balanced",
  setModelPreference: (modelPreference) => set({ modelPreference }),
  activeMode: "research",
  setActiveMode: (mode) => set({ activeMode: mode }),

  // Theme — light by default with localStorage sync
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

  // Auth state
  user: MOCK_DEFAULT_USER,
  isAuthenticated: true,
  login: (userData) => {
    const newUser: User = {
      id: `usr_${Date.now()}`,
      name: userData.name || "Researcher User",
      email: userData.email || "user@cognexa.ai",
      role: userData.role || "Academic Researcher",
      institution: userData.institution || "Research Institution",
      avatar:
        userData.avatar ||
        `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(userData.name || "User")}`,
    };
    set({ user: newUser, isAuthenticated: true });
  },
  logout: () => set({ user: null, isAuthenticated: false }),

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
