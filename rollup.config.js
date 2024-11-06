import typescript from 'rollup-plugin-typescript2';
import { terser } from 'rollup-plugin-terser';
import pkg from './package.json';
import polyfillNode from 'rollup-plugin-polyfill-node';
import resolve from '@rollup/plugin-node-resolve'; // Added resolve plugin

export default {
  input: 'src/index.ts',
  output: [
    {
      file: 'dist/index.js', // CommonJS format
      format: 'cjs',
      exports: 'named',
      sourcemap: true,
      globals: {
        https: 'https',   // Specify global variable names
        url: 'url',
      },
    },
    {
      file: pkg.module || 'dist/index.esm.js', // Default to a specific file if pkg.module is not defined
      format: 'es',
      exports: 'named',
      sourcemap: true,
      globals: {
        https: 'https',   // Specify global variable names
        url: 'url',
      },
    },
    {
      file: 'dist/grab-api.umd.js', // UMD format
      format: 'umd',
      name: 'GrabAPI', // Global variable name for UMD
      exports: 'named',
      sourcemap: true,
      globals: {
        https: 'https',   // Specify global variable names
        url: 'url',
      },
    },
  ],
  plugins: [
    polyfillNode(),
    resolve({
      preferBuiltins: true, // To prefer built-in Node modules
    }),
    typescript({
      clean: true,
      useTsconfigDeclarationDir: true,
      tsconfigOverride: {
        compilerOptions: {
          declaration: true,
          declarationDir: 'dist/types',
        },
      },
    }),
    terser(), // Minify the output
  ],
  external: [
    'https', 'url', 'rollup-plugin-polyfill-node',
    ...Object.keys(pkg.dependencies || {}), // Exclude dependencies from the bundle
    ...Object.keys(pkg.peerDependencies || {}),
  ],
};
