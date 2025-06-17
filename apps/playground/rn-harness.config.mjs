const config = {
  include: '**/*.test.tsx',
  // runner: {
  //   platform: 'ios',
  //   deviceId: 'iPhone 16 Pro',
  //   bundleId: 'org.reactjs.native.example.Playground',
  // },

  runner: {
    platform: 'android',
    deviceId: 'Pixel_9_Pro_API_35',
    bundleId: 'com.playground',
  },
};

export default config;
