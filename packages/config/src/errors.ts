import { HarnessError } from '@react-native-harness/tools';

export class ConfigValidationError extends HarnessError {
  constructor(
    public readonly filePath: string,
    public readonly validationErrors: string[]
  ) {
    const lines = [
      `Configuration validation failed in ${filePath}`,
      '',
      'The following issues were found:',
      '',
    ];

    validationErrors.forEach((error, index) => {
      lines.push(`  ${index + 1}. ${error}`);
    });

    lines.push(
      '',
      'Please fix these issues and try again.',
      'For more information, visit: https://react-native-harness.dev/docs/configuration'
    );

    super(lines.join('\n'));
    this.name = 'ConfigValidationError';
  }
}

export class ConfigNotFoundError extends HarnessError {
  constructor(public readonly searchPath: string) {
    const lines = [
      'Configuration file not found',
      '',
      `Searched for configuration files in: ${searchPath}`,
      'and all parent directories.',
      '',
      'React Native Harness looks for one of these files:',
      '  • rn-harness.config.js',
      '  • rn-harness.config.mjs',
      '  • rn-harness.config.cjs',
      '  • rn-harness.config.json',
      '',
      'For more information, visit: https://www.react-native-harness.dev/docs/getting-started/configuration',
    ];

    super(lines.join('\n'));
    this.name = 'ConfigNotFoundError';
  }
}

export class ConfigLoadError extends HarnessError {
  public override readonly cause?: Error;

  constructor(public readonly filePath: string, cause?: Error) {
    const lines = [
      'Failed to load configuration file',
      '',
      `File: ${filePath}`,
      '',
    ];

    if (cause) {
      lines.push('Error details:');
      lines.push(`  ${cause.message}`);
      lines.push('');
    }

    lines.push(
      'This could be due to:',
      '  • Syntax errors in your configuration file',
      '  • Missing dependencies or modules',
      '  • Invalid file format or encoding',
      '  • File permissions issues',
      '',
      'Troubleshooting steps:',
      '  1. Check the file syntax and format',
      '  2. Ensure all required dependencies are installed',
      '  3. Verify file permissions',
      '  4. Try creating a new configuration file',
      '',
      'For more help, visit: https://www.react-native-harness.dev/docs/getting-started/configuration'
    );

    super(lines.join('\n'));
    this.name = 'ConfigLoadError';
    this.cause = cause;
  }
}
