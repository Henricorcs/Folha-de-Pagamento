// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // As duas regras clássicas: hook fora de lugar quebra o componente, e
      // dependência faltando faz a tela mostrar dado velho.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);

// O `recommended` do eslint-plugin-react-hooks v7 traz mais quinze regras do
// React Compiler. Não estão ligadas de propósito: a que mais aparece aqui
// (`set-state-in-effect`) acusa o formulário que se preenche com o que veio do
// servidor — Configurações, Funcionário, variáveis do mês. É padrão conhecido e
// funciona; trocá-lo é decisão de refatoração, não de configurar o lint.
