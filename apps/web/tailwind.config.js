/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#e9faf6',
          100: '#c4f1e6',
          200: '#8fe3d0',
          300: '#55cfb6',
          400: '#2cb49c',
          500: '#1f8a70', // primary teal
          600: '#17705c',
          700: '#0f5c68', // deep teal accent
          800: '#0b3d44',
          900: '#082a2e',
          950: '#061f22',
        },
        ink: {
          DEFAULT: '#0b1b1e',
          soft: '#2d3f44',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
      keyframes: {
        fadeUp: { '0%': { opacity: '0', transform: 'translateY(8px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        pulseSoft: { '0%,100%': { opacity: '1' }, '50%': { opacity: '.55' } },
        shimmer: { '0%': { backgroundPosition: '-600px 0' }, '100%': { backgroundPosition: '600px 0' } },
      },
      animation: { fadeUp: 'fadeUp .35s ease-out both', pulseSoft: 'pulseSoft 1.6s ease-in-out infinite' },
    },
  },
  plugins: [],
};
