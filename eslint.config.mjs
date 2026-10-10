import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import tseslint from 'typescript-eslint'

const WORKSPACE_EXPORTS = {
  group: ['@weaver/*/src/**', '@weaver/*/dist/**', '**/packages/*/src/**', '**/apps/*/src/**'],
  message: 'Consume workspace packages through their declared public exports.',
}

const MODULE_FUNCTIONS = [
  'Program > FunctionDeclaration',
  'Program > ExportNamedDeclaration > FunctionDeclaration',
  'Program > ExportDefaultDeclaration > FunctionDeclaration',
  'Program > VariableDeclaration > VariableDeclarator > :matches(ArrowFunctionExpression, FunctionExpression)',
  'Program > ExportNamedDeclaration > VariableDeclaration > VariableDeclarator > :matches(ArrowFunctionExpression, FunctionExpression)',
]

// The layers of each package, top first. A file imports from its own folder and from the layers below, never from a
// layer above; folders listed together are side by side and do not import each other.
const LAYERS = {
  'packages/engine': [['bin'], ['loop'], ['checks', 'guards'], ['unit-of-work', 'declaration', 'agents'], ['lib']],
  'apps/cli': [['bin'], ['commands'], ['runtimes', 'project'], ['link', 'output']],
}

const layerRules = Object.entries(LAYERS).flatMap(([root, layers]) =>
  layers.flatMap((layer, depth) =>
    layer.flatMap((folder) => {
      const closed = [...layers.slice(0, depth).flat(), ...layer.filter((other) => other !== folder)]

      // The top layer may import from every other.
      if (closed.length === 0) return []

      return {
        files: [`${root}/src/${folder}/**/*.ts`],
        rules: {
          'no-restricted-imports': [
            'error',
            {
              patterns: [
                WORKSPACE_EXPORTS,
                {
                  group: closed.map((other) => `**/${other}/**`),
                  message: `${folder}/ imports only from itself and from the layers below it (see LAYERS in eslint.config.mjs).`,
                },
              ],
            },
          ],
        },
      }
    }),
  ),
)

export default defineConfig(
  globalIgnores(['**/node_modules/**', '**/dist/**', '**/coverage/**', '.cache/**']),
  {
    files: ['**/*.{js,mjs}'],
    extends: [js.configs.recommended],
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: false }],
    },
  },
  {
    files: ['**/*.{js,mjs,ts,tsx}'],
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      'no-restricted-imports': ['error', { patterns: [WORKSPACE_EXPORTS] }],
    },
  },
  {
    files: ['packages/*/src/**/*.ts', 'apps/cli/src/**/*.ts'],
    rules: {
      'max-classes-per-file': ['error', 1],
      '@typescript-eslint/no-extraneous-class': 'error',
    },
  },
  {
    files: ['packages/*/src/**/*.ts', 'apps/cli/src/**/*.ts'],
    ignores: ['packages/*/src/lib/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: MODULE_FUNCTIONS.join(', '),
          message:
            'Outside lib/, behavior lives in classes: make this a method of the class it serves, or move it to lib/ if it is a pure transformation that knows nothing of the package’s concepts.',
        },
      ],
    },
  },
  ...layerRules,
)
