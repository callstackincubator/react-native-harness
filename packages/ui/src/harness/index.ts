import { Platform } from "react-native";
import { HarnessUIModule } from "../types.js";

const getHarnessUI = (): HarnessUIModule => {
  if (Platform.OS === 'web') {
    return require('./web-harness.js').default;
  }

  return require('./native-harness.js').default;
}

export default getHarnessUI();