/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{vue,js,ts,jsx,tsx}"],
  darkMode: "media",
  theme: {
    extend: {
      typography: {
        DEFAULT: {
          css: {
            maxWidth: "100%",
            "*": {
              marginTop: "0",
              marginBottom: "0.25rem",
            },
            "*:last-child": {
              marginBottom: "0",
            },
          },
        },
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};
