import { terser } from 'rollup-plugin-terser';
import pkg from './package.json';
import commonjs from '@rollup/plugin-commonjs';
import polyfillNode from 'rollup-plugin-polyfill-node';
import resolve from '@rollup/plugin-node-resolve';

export default {
  input: 'src/index.ts',
  output: [
    {
      file: 'dist/index.js',
      format: 'cjs',
      exports: 'named',
      sourcemap: true,
      globals: {
        https: 'https',
        url: 'url',
      },
    },
    {
      file: pkg.module || 'dist/index.esm.js',
      format: 'es',
      exports: 'named',
      sourcemap: true,
      globals: {
        https: 'https',
        url: 'url',
      },
    },
    {
      file: 'dist/grab-api.umd.js',
      format: 'umd',
      name: 'GrabAPI',
      exports: 'named',
      sourcemap: true,
      globals: {
        https: 'https',
        url: 'url',
      },
    },
  ],
  plugins: [
    polyfillNode(),
    resolve({
      preferBuiltins: true,
    }),
    commonjs(),
    terser(),
  ],
  external: [
    'https', 'url', 'rollup-plugin-polyfill-node',
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.peerDependencies || {}),
  ],
};
