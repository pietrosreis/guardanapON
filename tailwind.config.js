/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./*.html", "./js/**/*.js"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        "primary":               "#576100",
        "primary-container":     "#e0f818",
        "on-primary-fixed":      "#414900",
        "on-primary-container":  "#525c00",
        "inverse-primary":       "#e6fe22",
        "outline":               "#757777",
        "outline-variant":       "#acadad",
        "surface":               "#f9f5ec",
        "surface-bright":        "#f9f5ec",
        "surface-dim":           "#cdc9be",
        "surface-container-low": "#f3efe6",
        "surface-container":     "#ece8df",
        "on-surface":            "#2d2f2f",
        "on-background":         "#2d2f2f",
        "secondary":             "#5c5b5b",
        "secondary-dim":         "#504f4f",
        "inverse-surface":       "#0c0f0f",
      },
      fontFamily: { body: ["Space Grotesk", "sans-serif"] },
      borderRadius: { DEFAULT: "0px", lg: "0px", xl: "0px", full: "9999px" },
    },
  },
  safelist: [
    // arbitrary rotation classes (decimals confuse the content scanner)
    "rotate-[0deg]", "rotate-[-0.5deg]", "rotate-[0.3deg]", "rotate-[-0.3deg]", "rotate-[0.5deg]",
    "rotate-[-0.8deg]", "rotate-[0.2deg]", "rotate-[0.6deg]", "rotate-[1.2deg]",
    "rotate-[-1.5deg]", "rotate-[1.5deg]", "rotate-[-2deg]", "rotate-[1deg]", "rotate-[-1deg]",
    "rotate-[0.8deg]", "rotate-[0.4deg]", "rotate-[45deg]",
    // arbitrary text sizes used throughout
    "text-[9px]", "text-[10px]", "text-[11px]", "text-[12px]",
    // error color
    "text-[#b02500]",
    // min-heights for error divs
    "min-h-[14px]", "min-h-[16px]", "min-h-[18px]", "min-h-[140px]",
    // button shadows
    "shadow-[4px_4px_0px_#576100]", "shadow-[3px_3px_0px_#576100]",
    "shadow-[0_20px_48px_rgba(0,0,0,0.6)]", "shadow-[0_20px_48px_rgba(0,0,0,0.55)]",
    "shadow-[0_20px_40px_rgba(12,15,15,0.1)]", "shadow-[0_4px_12px_rgba(12,15,15,0.05)]",
    // focus ring
    "focus:border-[#D8EF00]",
    // arbitrary colors on elements
    "text-[#0c0f0f]", "bg-[#D8EF00]", "border-[#0c0f0f]",
    // tracking
    "tracking-[0.2em]", "tracking-[0.25em]",
  ],
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/container-queries'),
  ],
}
