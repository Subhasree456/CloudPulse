/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        accent: "rgb(var(--accent-rgb) / <alpha-value>)",
        info: "rgb(var(--info-rgb) / <alpha-value>)",
        canvas: "rgb(var(--canvas-rgb) / <alpha-value>)",
        panel: "rgb(var(--panel-rgb) / <alpha-value>)",
        line: "rgb(var(--line-rgb) / <alpha-value>)",
        ink: "rgb(var(--ink-rgb) / <alpha-value>)",
        muted: "rgb(var(--muted-rgb) / <alpha-value>)",
        positive: "rgb(var(--positive-rgb) / <alpha-value>)",
        warning: "rgb(var(--warning-rgb) / <alpha-value>)",
        danger: "rgb(var(--danger-rgb) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["Inter Variable", "Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        glow: "0 0 40px rgb(var(--accent-rgb) / 0.16)",
        card: "0 24px 60px -30px rgba(0, 0, 0, 0.75)",
      },
      animation: {
        "fade-up": "fade-up 0.5s cubic-bezier(0.22, 1, 0.36, 1) both",
        "pulse-slow": "pulse 3.4s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        shimmer: "shimmer 1.8s linear infinite",
        "spin-slow": "spin 14s linear infinite",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-600px 0" },
          "100%": { backgroundPosition: "600px 0" },
        },
      },
    },
  },
  plugins: [],
};
