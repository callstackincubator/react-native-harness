import { getConfig } from '@react-native-harness/config';

const { config } = await getConfig(process.cwd());
const pods = config.coverage?.native?.ios?.pods ?? [];
console.log(JSON.stringify(pods));
