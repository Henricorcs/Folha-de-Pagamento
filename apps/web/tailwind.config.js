/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Acento da casa: o azul da logo da ilnet. Os tons foram tirados do
        // próprio arquivo — a onda vive em #4E8ACE e o "ilnet" desce de
        // #3294F0 a #13B2F9. `brand-500` é o tom da identidade; `brand-600` é
        // o dos botões sólidos, escuro o bastante para texto branco em cima
        // (contraste 5.0:1, acima do mínimo de 4.5:1).
        brand: {
          50: '#EBF5FE',
          100: '#D5EBFD',
          200: '#AAD6FB',
          300: '#74BCF8',
          400: '#3A9FF3',
          500: '#1490EE',
          600: '#0A72C4',
          700: '#0A5C9E',
          800: '#0D4C80',
          900: '#10406B',
          950: '#0A2847',
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
