import { getConfig } from '@react-native-harness/config';

const { config } = await getConfig(process.cwd());
const modules = config.coverage?.native?.android?.modules ?? [];
console.log(JSON.stringify(modules));
