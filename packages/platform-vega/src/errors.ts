export class VegaAppPathError extends Error {
  constructor(reason: 'missing' | 'invalid', appPath?: string) {
    super(
      reason === 'missing'
        ? 'App is not installed on the Vega device and HARNESS_APP_PATH is not set. Build a debug package with "npx react-native build-vega --build-type Debug" and point HARNESS_APP_PATH at the resulting .vpkg file.'
        : `HARNESS_APP_PATH points to a missing .vpkg file: ${appPath ?? '<unknown>'}`
    );
    this.name = 'VegaAppPathError';
  }
}

export class VegaMetroPortError extends Error {
  constructor(metroPort: number) {
    super(
      `Vega devices can only reach Metro through port 8081, but Metro is running on port ${metroPort} and the "vda" tool needed to map the ports was not found. Free port 8081 or set "metroPort: 8081" in the harness config.`
    );
    this.name = 'VegaMetroPortError';
  }
}

export class VegaVdaSerialError extends Error {
  constructor(deviceId: string, serials: string[]) {
    super(
      `Could not tell which vda device corresponds to "${deviceId}" (vda lists: ${
        serials.join(', ') || 'none'
      }). Mapping a Metro port other than 8081 needs a single attached device, or a physical device whose serial vda reports.`
    );
    this.name = 'VegaVdaSerialError';
  }
}
