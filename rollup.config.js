import typescript from 'rollup-plugin-typescript2';
import { terser } from 'rollup-plugin-terser';
import pkg from './package.json';

export default {
  input: 'src/index.ts',
  output: [
    {
      file: 'dist/index.js', // CommonJS format
      format: 'cjs',
      exports: 'named',
      sourcemap: true,
    },
    {
      file: pkg.module || 'dist/index.esm.js', // Default to a specific file if pkg.module is not defined
      format: 'es',
      exports: 'named',
      sourcemap: true,
    },
    {
      file: 'dist/grab-api.umd.js', // UMD format
      format: 'umd',
      name: 'GrabAPI', // Global variable name for UMD
      exports: 'named',
      sourcemap: true,
    },
  ],
  plugins: [
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
    ...Object.keys(pkg.dependencies || {}), // Exclude dependencies from the bundle
    ...Object.keys(pkg.peerDependencies || {}),
  ],
};
