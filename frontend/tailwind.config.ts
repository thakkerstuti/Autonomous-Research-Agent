import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class", "html.dark"],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg:       "var(--bg)",
        canvas:   "var(--canvas)",
        surface:  "var(--surface)",
        surface2: "var(--surface-2)",
        surface3: "var(--surface-3)",
        line:     "var(--line)",
        "line-hover": "var(--line-hover)",
        ink:      "var(--ink)",
        "ink-soft":  "var(--ink-soft)",
        "ink-faint": "var(--ink-faint)",
        rose:     "var(--rose)",
        "rose-soft": "var(--rose-soft)",
        blush:    "var(--blush)",
        "blush-deep": "var(--blush-deep)",
        lavender: "var(--lavender)",
        "lavender-soft": "var(--lavender-soft)",
        teal:     "var(--teal)",
        "teal-soft": "var(--teal-soft)",
        ok:       "var(--ok)",
        warn:     "var(--warn)",
        bad:      "var(--bad)",
      },
      fontFamily: {
        serif: ["var(--font-serif)", "Georgia", "serif"],
        sans:  ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      borderRadius: {
        panel: "16px",
        xl:    "14px",
        "2xl": "18px",
        "3xl": "24px",
      },
      boxShadow: {
        panel:       "var(--shadow-panel)",
        "panel-hover":"var(--shadow-panel-hover)",
        "panel-drag": "var(--shadow-panel-drag)",
      },
      backgroundImage: {
        "gradient-rose":    "linear-gradient(135deg, var(--rose), var(--lavender))",
        "gradient-blush":   "linear-gradient(135deg, var(--blush), var(--lavender-soft))",
        "gradient-canvas":  "linear-gradient(160deg, var(--bg) 0%, var(--canvas) 100%)",
      },
    },
  },
  plugins: [],
};
export default config;
