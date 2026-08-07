/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Acento da casa: o provedor vende luz dentro de vidro, então a marca
        // é um turquesa de fibra óptica. `brand-600` é o tom dos botões
        // sólidos (contraste ~4.9:1 com branco).
        brand: {
          50: '#EDFBF8',
          100: '#D2F5EE',
          200: '#A6EADF',
          300: '#6DD7C9',
          400: '#33BCAD',
          500: '#0E9E91',
          600: '#0C7F76',
          700: '#0A6660',
          800: '#0A524E',
          900: '#0B4340',
          950: '#042624',
        },
        // Tinta de livro-caixa: fundo da barra lateral e texto forte.
        tinta: {
          50: '#F1F4F9',
          100: '#E1E7F0',
          200: '#C2CCDD',
          300: '#93A2BD',
          400: '#6B7C9C',
          500: '#46587A',
          600: '#2A3A57',
          700: '#1B2740',
          800: '#111A2E',
          900: '#0A1020',
        },
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: [
          '"IBM Plex Sans"',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'sans-serif',
        ],
      },
      boxShadow: {
        // Sombras em camadas rasas: papel sobre papel, não caixa flutuante.
        card: '0 1px 2px -1px rgb(10 16 32 / 0.06), 0 4px 16px -8px rgb(10 16 32 / 0.10)',
        'card-hover':
          '0 2px 4px -2px rgb(10 16 32 / 0.08), 0 12px 28px -12px rgb(10 16 32 / 0.18)',
        aba: '0 1px 0 0 rgb(10 16 32 / 0.04)',
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1.125rem',
      },
      keyframes: {
        surgir: {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'none' },
        },
        crescer: {
          from: { transform: 'scaleY(0)' },
          to: { transform: 'scaleY(1)' },
        },
      },
      animation: {
        surgir: 'surgir 0.4s cubic-bezier(0.16, 1, 0.3, 1) both',
        crescer: 'crescer 0.7s cubic-bezier(0.16, 1, 0.3, 1) both',
      },
    },
  },
  plugins: [],
};
