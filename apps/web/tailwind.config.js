/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef4ff',
          100: '#d9e6ff',
          200: '#bcd3ff',
          300: '#8eb5ff',
          400: '#598cff',
          500: '#3563eb',
          600: '#2447d0',
          700: '#1e39a8',
          800: '#1e3286',
          900: '#1e2f6c',
        },
      },
    },
  },
  plugins: [],
};
