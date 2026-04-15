/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./node_modules/@mariozechner/pi-web-ui/dist/**/*.{js,ts}"
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}