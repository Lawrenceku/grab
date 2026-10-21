import { readFileSync } from 'node:fs';
import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import commonjs from '@rollup/plugin-commonjs';
import polyfillNode from 'rollup-plugin-polyfill-node';
import resolve from '@rollup/plugin-node-resolve';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));

const globals = { https: 'https', url: 'url' };

export default [
  {
    input: 'src/index.ts',
    output: [
      {
        file: 'dist/index.js',
        format: 'cjs',
        exports: 'named',
        sourcemap: true,
      },
      {
        file: pkg.module || 'dist/index.esm.js',
        format: 'es',
        exports: 'named',
        sourcemap: true,
      },
      {
        file: 'dist/grab-api.umd.js',
        format: 'umd',
        name: 'GrabAPI',
        exports: 'named',
        sourcemap: true,
        globals,
      },
    ],
    plugins: [
      typescript({ tsconfig: './tsconfig.json' }),
      polyfillNode(),
      resolve({
        preferBuiltins: true,
        extensions: ['.ts', '.js'],
      }),
      commonjs(),
      terser(),
    ],
    external: [
      'https',
      'url',
      ...Object.keys(pkg.dependencies || {}),
      ...Object.keys(pkg.peerDependencies || {}),
    ],
  },
  {
    input: 'src/index.node.ts',
    output: [
      {
        file: 'dist/index.node.js',
        format: 'cjs',
        exports: 'named',
        sourcemap: true,
      },
      {
        file: 'dist/index.node.mjs',
        format: 'es',
        exports: 'named',
        sourcemap: true,
      },
    ],
    plugins: [
      typescript({ tsconfig: './tsconfig.json' }),
      resolve({
        preferBuiltins: true,
        extensions: ['.ts', '.js'],
      }),
      commonjs(),
      terser(),
    ],
    external: [
      'node:http',
      'node:https',
      'node:zlib',
      'node:url',
      'node:stream',
      'node:net',
      'http',
      'https',
      'zlib',
      'url',
      'stream',
      ...Object.keys(pkg.dependencies || {}),
      ...Object.keys(pkg.peerDependencies || {}),
    ],
  },
];