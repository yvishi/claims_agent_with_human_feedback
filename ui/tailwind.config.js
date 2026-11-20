/** Colours are CSS variables (src/index.css) so light and dark are defined once. */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: v("surface"), raised: v("raised"), sunken: v("sunken"), line: v("line"),
        ink: v("ink"), ink2: v("ink2"), ink3: v("ink3"),
        brand: v("brand"), brandsoft: v("brandsoft"),
        paid: v("paid"), deduct: v("deduct"),
        good: v("good"), warn: v("warn"), serious: v("serious"), crit: v("crit"),
      },
      fontFamily: { sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"] },
      boxShadow: { card: "0 1px 2px rgb(0 0 0 / 0.04), 0 4px 16px -6px rgb(0 0 0 / 0.08)" },
    },
  },
};
