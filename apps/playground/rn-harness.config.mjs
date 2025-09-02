const config = {
  include: ['./demo.harness.ts'],

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
      systemVersion: '18.0',
    },
  ],
  defaultRunner: 'android',
  bridgeTimeout: 120000,
};

export default config;
