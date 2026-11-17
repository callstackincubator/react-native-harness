export type CompilerName = 'webpack' | 'rspack';

/** What differs between the two compilers, in one place. */
export const COMPILERS: Record<
  CompilerName,
  { bundlerName: string; displayName: string; packageName: string }
> = {
  webpack: {
    bundlerName: 'webpack',
    displayName: 'webpack',
    packageName: 'webpack',
  },
  rspack: {
    bundlerName: 'rspack',
    displayName: 'Rspack',
    packageName: '@rspack/core',
  },
};
