const config = {
  entryPoint: './src/main.tsx',
  appRegistryComponentName: 'Playground',

  runners: [
    {
      name: 'android',
      platform: 'android',
      deviceId: 'Pixel_8_API_35',
      bundleId: 'com.playground',
    },
    {
      name: 'ios',
      platform: 'ios',
      deviceId: 'iPhone 16 Pro',
      bundleId: 'org.reactjs.native.example.Playground',
      systemVersion: '18.6',
    },
  ],
  defaultRunner: 'android',
  bridgeTimeout: 120000,

  resetEnvironmentBetweenTestFiles: true,
  unstable__skipAlreadyIncludedModules: false,
};

export default config;
