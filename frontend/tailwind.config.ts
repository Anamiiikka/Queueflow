import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // A calm dark dashboard palette.
        card: "#0c0c0e",
        edge: "#1e1e24",
        ink: "#e7e7ea",
        muted: "#8a8a93",
      },
    },
  },
  plugins: [],
};

export default config;
