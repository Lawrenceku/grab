import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import commonjs from '@rollup/plugin-commonjs';
import resolve from '@rollup/plugin-node-resolve';

export default [
  // Browser / Edge / Worker entry
  {
    input: 'src/index.ts',
    output: [
      {
        file: 'dist/index.js',
        format: 'es',
        exports: 'named',
        sourcemap: true,
      },
      {
        file: 'dist/index.cjs',
        format: 'cjs',
        exports: 'named',
        sourcemap: true,
      },
      {
        file: 'dist/grab-api.umd.js',
        format: 'umd',
        name: 'GrabAPI',
        exports: 'named',
        sourcemap: true,
      },
    ],
    plugins: [
      typescript({ tsconfig: './tsconfig.json' }),
      resolve({
        browser: true,
        extensions: ['.ts', '.js'],
      }),
      commonjs(),
      terser(),
    ],
  },
  // Node entry
  {
    input: 'src/index.node.ts',
    output: [
      {
        file: 'dist/index.node.js',
        format: 'es',
        exports: 'named',
        sourcemap: true,
      },
      {
        file: 'dist/index.node.cjs',
        format: 'cjs',
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
      /^node:/,
      'http',
      'https',
      'zlib',
      'url',
      'stream',
      'buffer',
      'events',
      'net',
      'tls',
      'fs',
      'path',
      'os',
    ],
  },
];