/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{tsx,html}"
  ],
  // Tailwind's base/preflight reset conflicts with Ant Design's own button,
  // form and typography resets (e.g. `button { background-color: transparent }`
  // fighting AntD's low-specificity `:where()` rules). Tailwind is only used
  // for a couple of small utilities (e.g. `animate-spin`) here, not layout,
  // so disable preflight rather than fight AntD's styling.
  corePlugins: {
    preflight: false
  },
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        }
      },
    },
  },
  plugins: [],
}
