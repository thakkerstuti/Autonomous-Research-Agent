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
        /* Primary cyan */
        rose:     "var(--cyan)",
        "rose-soft": "var(--cyan-soft)",
        /* Blush → cyan pulse */
        blush:    "var(--cyan-pulse)",
        "blush-deep": "var(--cyan-glow)",
        /* Lavender → violet */
        lavender: "var(--violet-soft)",
        "lavender-soft": "var(--violet-mist)",
        /* Teal → mint */
        teal:     "var(--mint)",
        "teal-soft": "var(--mint-glow)",
        /* New tokens */
        cyan:       "var(--cyan)",
        "cyan-soft": "var(--cyan-soft)",
        violet:     "var(--violet)",
        "violet-soft": "var(--violet-soft)",
        mint:       "var(--mint)",
        ok:       "var(--ok)",
        warn:     "var(--warn)",
        bad:      "var(--bad)",
      },
      fontFamily: {
        serif: ["var(--font-serif)", "system-ui", "sans-serif"],
        sans:  ["var(--font-sans)", "system-ui", "sans-serif"],
        mono:  ["var(--font-mono)", "monospace"],
      },
      borderRadius: {
        panel: "14px",
        xl:    "12px",
        "2xl": "16px",
        "3xl": "20px",
      },
      boxShadow: {
        panel:        "var(--shadow-panel)",
        "panel-hover":"var(--shadow-panel-hover)",
        "panel-drag": "var(--shadow-panel-drag)",
        "cyan-glow":  "0 0 20px rgba(0,212,255,0.25), 0 0 60px rgba(0,212,255,0.10)",
        "violet-glow":"0 0 20px rgba(123,95,255,0.25), 0 0 60px rgba(123,95,255,0.10)",
      },
      backgroundImage: {
        "gradient-rose":   "linear-gradient(135deg, var(--cyan), var(--violet))",
        "gradient-blush":  "linear-gradient(135deg, var(--cyan-pulse), var(--violet-mist))",
        "gradient-canvas": "linear-gradient(160deg, var(--bg) 0%, var(--canvas) 100%)",
        "gradient-cyan":   "linear-gradient(135deg, var(--cyan), var(--mint))",
        "gradient-violet": "linear-gradient(135deg, var(--violet), var(--violet-soft))",
        "gradient-neural": "linear-gradient(120deg, var(--cyan) 0%, var(--violet-soft) 55%, var(--mint) 100%)",
      },
    },
  },
  plugins: [],
};
export default config;
