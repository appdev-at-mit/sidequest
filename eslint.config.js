const js = require('@eslint/js');
const ts = require('typescript-eslint');
module.exports = ts.config({ignores:['**/dist/**']}, js.configs.recommended, ...ts.configs.recommended, {files:['**/*.{ts,tsx}'],rules:{'@typescript-eslint/no-explicit-any':'off','@typescript-eslint/no-unused-vars':['error',{argsIgnorePattern:'^_',varsIgnorePattern:'^_'}]}});
