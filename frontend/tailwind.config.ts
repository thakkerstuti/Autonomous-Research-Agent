import type { Config } from "tailwindcss";

/* Colours are RGB triplets in globals.css so opacity modifiers (bg-accent/10) work. */
const rgb = (v: string) => `rgb(var(${v}) / <alpha-value>)`;

const config: Config = {
  darkMode: ["class", "html.dark"],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg:        rgb("--bg"),
        canvas:    rgb("--canvas"),
        surface:   rgb("--surface"),
        surface2:  rgb("--surface-2"),
        surface3:  rgb("--surface-3"),
        line:         "var(--line)",
        "line-hover": "var(--line-hover)",
        ink:         rgb("--ink"),
        "ink-soft":  rgb("--ink-soft"),
        "ink-faint": rgb("--ink-faint"),
        primary:      rgb("--primary"),
        "on-primary": rgb("--on-primary"),
        accent:          rgb("--accent"),
        "accent-strong": rgb("--accent-strong"),
        "accent-soft":   "var(--accent-soft)",
        "accent-line":   "var(--accent-line)",
        steel:        rgb("--steel"),
        ok:   rgb("--ok"),
        warn: rgb("--warn"),
        bad:  rgb("--bad"),

        /* Legacy aliases — older class names resolve into the new palette */
        rose:            rgb("--accent"),
        "rose-soft":     rgb("--accent-strong"),
        blush:           "var(--accent-soft)",
        "blush-deep":    "var(--accent-line)",
        lavender:        rgb("--accent"),
        "lavender-soft": "var(--accent-soft)",
        teal:            rgb("--steel"),
        "teal-soft":     "var(--steel-soft)",
        cyan:            rgb("--steel"),
        violet:          rgb("--accent"),
        mint:            rgb("--ok"),
        grad1:           rgb("--accent"),
        grad2:           rgb("--accent"),
      },
      fontFamily: {
        serif: ["var(--font-serif)", "Georgia", "serif"],
        sans:  ["var(--font-sans)", "system-ui", "sans-serif"],
        mono:  ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      fontSize: {
        /* Editorial scale — serif display, sans interface, mono data */
        "display-xl": ["clamp(40px, 4.6vw, 62px)", { lineHeight: "1.02", letterSpacing: "-0.022em" }],
        display:      ["clamp(32px, 3.4vw, 44px)", { lineHeight: "1.06", letterSpacing: "-0.018em" }],
        title:        ["26px", { lineHeight: "1.18", letterSpacing: "-0.012em" }],
        "title-sm":   ["20px", { lineHeight: "1.25", letterSpacing: "-0.01em" }],
        heading:      ["14.5px", { lineHeight: "1.35", letterSpacing: "-0.01em" }],
        "body-lg":    ["16.5px", { lineHeight: "1.7" }],
        body:         ["14px", { lineHeight: "1.55" }],
        meta:         ["12.5px", { lineHeight: "1.45" }],
        micro:        ["10.5px", { lineHeight: "1.3", letterSpacing: "0.08em" }],
        "2xs": ["11px", { lineHeight: "16px", letterSpacing: "0.01em" }],
      },
      borderRadius: {
        panel: "14px",
        xl:    "12px",
        "2xl": "16px",
        "3xl": "22px",
      },
      boxShadow: {
        sm:           "var(--shadow-sm)",
        panel:        "var(--shadow-panel)",
        "panel-hover":"var(--shadow-panel-hover)",
        "panel-drag": "var(--shadow-panel-drag)",
      },
      transitionTimingFunction: {
        out:     "cubic-bezier(0.23, 1, 0.32, 1)",
        "in-out":"cubic-bezier(0.77, 0, 0.175, 1)",
        drawer:  "cubic-bezier(0.32, 0.72, 0, 1)",
      },
      backgroundImage: {
        "gradient-rose": "linear-gradient(90deg, rgb(var(--accent)), rgb(var(--accent-strong)))",
      },
    },
  },
  plugins: [],
};
export default config;
