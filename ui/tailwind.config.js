/** Colours are CSS variables (src/index.css) so light and dark are defined once. */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  // dark: follows the device unless the user picked a theme (data-theme on <html>), matching index.css.
  darkMode: ["variant", [
    "@media (prefers-color-scheme: dark) { &:not(:where([data-theme=light], [data-theme=light] *)) }",
    "&:where([data-theme=dark], [data-theme=dark] *)",
  ]],
  theme: {
    extend: {
      colors: {
        surface: v("surface"), raised: v("raised"), sunken: v("sunken"), line: v("line"),
        ink: v("ink"), ink2: v("ink2"), ink3: v("ink3"),
        brand: v("brand"), onbrand: v("onbrand"), brandsoft: v("brandsoft"),
        navy: v("navy"), sky: v("sky"), mist: v("mist"),
        paid: v("paid"), deduct: v("deduct"),
        good: v("good"), warn: v("warn"), serious: v("serious"), crit: v("crit"),
      },
      fontFamily: { sans: ["Plus Jakarta Sans", "Inter", "ui-sans-serif", "system-ui", "sans-serif"] },
      boxShadow: {
        card: "0 1px 2px rgb(var(--shadow) / 0.06), 0 12px 32px -16px rgb(var(--shadow) / 0.3)",
        float: "0 2px 6px rgb(var(--shadow) / 0.08), 0 40px 80px -28px rgb(var(--shadow) / 0.45)",
      },
      borderRadius: { glass: "24px" },
    },
  },
};
