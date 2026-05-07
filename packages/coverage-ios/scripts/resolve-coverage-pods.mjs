import { getConfig } from '@react-native-harness/config';

try {
  const { config } = await getConfig(process.cwd());
  const pods = config.coverage?.native?.ios?.pods ?? [];
  console.log(JSON.stringify(pods));
} catch {
  console.log('[]');
}
