import { create } from "zustand";
import { ChatMessage, ModelPreference, Mode, User } from "./types";

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
  // User Authentication
  user: User | null;
  isAuthenticated: boolean;
  login: (userData: Partial<User>) => void;
  logout: () => void;
  // per-mode chat history, kept in memory so switching modes never mixes threads
  chatHistories: Record<Mode, ChatMessage[]>;
  appendMessage: (mode: Mode, message: ChatMessage) => void;
  updateMessage: (mode: Mode, id: string, patch: Partial<ChatMessage>) => void;
  resetHistory: (mode: Mode, messages: ChatMessage[]) => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarOpen: true,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  modelPreference: "balanced",
  setModelPreference: (modelPreference) => set({ modelPreference }),
  activeMode: "research",
  setActiveMode: (mode) => set({ activeMode: mode }),
  
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
      avatar: userData.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(userData.name || "User")}`,
    };
    set({ user: newUser, isAuthenticated: true });
  },
  logout: () => set({ user: null, isAuthenticated: false }),

  chatHistories: { research: [], paper: [] },
  appendMessage: (mode, message) =>
    set((s) => ({
      chatHistories: {
        ...s.chatHistories,
        [mode]: [...s.chatHistories[mode], message],
      },
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

