import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['src/**/*.ts'],
        languageOptions: {
            parserOptions: {
                ecmaVersion: 'latest',
                sourceType: 'module',
            },
        },
        rules: {
            "@typescript-eslint/naming-convention": "warn",
            "@typescript-eslint/semi": "warn",
            "curly": "warn",
            "eqeqeq": "warn",
            "no-throw-literal": "warn",
            "semi": "off"
        }
    },
    {
        ignores: ["dist/**", "out/**", "node_modules/**"]
    }
);
