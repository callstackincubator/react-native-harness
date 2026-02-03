import { spawn } from 'node:child_process';

const [packager, runner] = process.argv.slice(2);

if (!runner) {
  console.error('Runner input is required');
  process.exit(1);
}

const commands: Record<string, [string, string[]]> = {
  pnpm: ['pnpm', ['react-native-harness', '--harnessRunner', runner]],
  npm: ['npx', ['react-native-harness', '--harnessRunner', runner]],
  yarn: ['yarn', ['react-native-harness', '--harnessRunner', runner]],
  bun: ['bunx', ['react-native-harness', '--harnessRunner', runner]],
  deno: [
    'deno',
    ['run', '-A', 'npm:react-native-harness', '--harnessRunner', runner],
  ],
};

const key = packager || 'pnpm';
const entry = commands[key];

if (!entry) {
  console.error(`Unsupported packager: ${packager}`);
  console.error('Supported packagers: pnpm, npm, yarn, bun, deno');
  process.exit(1);
}

const [cmd, args] = entry;
const child = spawn(cmd, args, { stdio: 'inherit' });

child.on('close', (code) => process.exit(code ?? 1));
child.on('error', () => process.exit(1));
