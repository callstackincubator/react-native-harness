import { Platform } from "react-native";
import { HarnessUIModule } from "./types.js";

const getHarnessUI = (): HarnessUIModule => {
	if (Platform.OS === 'web') {
		return require('./WebHarnessUI.js').default;
	}

	return require('./NativeHarnessUI.js').default;
}

export default getHarnessUI();