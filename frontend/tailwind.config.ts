import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        surface: "var(--surface)",
        surface2: "var(--surface-2)",
        line: "var(--line)",
        ink: "var(--ink)",
        "ink-soft": "var(--ink-soft)",
        "ink-faint": "var(--ink-faint)",
        grad1: "var(--grad1)",
        grad2: "var(--grad2)",
        grad3: "var(--grad3)",
        ok: "var(--ok)",
        warn: "var(--warn)",
        bad: "var(--bad)",
      },
      fontFamily: {
        serif: ["var(--font-serif)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      borderRadius: { xl: "14px", "2xl": "18px" },
    },
  },
  plugins: [],
};
export default config;
