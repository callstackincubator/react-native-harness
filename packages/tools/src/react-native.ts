import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';

export const getReactNativePackagePath = (): string => {
    const require = createRequire(import.meta.url);
    const input = require.resolve('react-native', { paths: [process.cwd()] });
    return path.dirname(input);
}

export const getReactNativeCliPath = (): string => {
    const reactNativePackagePath = getReactNativePackagePath();
    const packageJson = JSON.parse(fs.readFileSync(path.join(reactNativePackagePath, 'package.json'), 'utf8'));
    return path.join(reactNativePackagePath, packageJson.bin['react-native']);
}

export const getExpoPackagePath = (): string => {
    const require = createRequire(import.meta.url);
    const input = require.resolve('expo', { paths: [process.cwd()] });
    return path.join(path.dirname(input), '..');
}

export const getExpoCliPath = (): string => {
    const expoPackagePath = getExpoPackagePath();
    const packageJson = JSON.parse(fs.readFileSync(path.join(expoPackagePath, 'package.json'), 'utf8'));
    return path.join(expoPackagePath, packageJson.bin['expo']);
}
