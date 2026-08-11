// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
    },
    rules: {
      // O Nest injeta pelo tipo do construtor: `private readonly x: Service` é
      // a assinatura toda, e o corpo vazio é o normal aqui.
      '@typescript-eslint/no-empty-function': [
        'error',
        { allow: ['constructors'] },
      ],
      // Argumento não usado é erro; parâmetro que só existe para chegar no
      // seguinte, não — daí o `_`.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Num teste, `any` é a ferramenta certa: o mock existe para responder uma
    // chamada, não para honrar a interface inteira do IXC ou do Prisma.
    files: ['**/*.spec.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
