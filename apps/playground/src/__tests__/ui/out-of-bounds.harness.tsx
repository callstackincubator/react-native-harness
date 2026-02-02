import { describe, test, render, expect } from "react-native-harness";
import { View } from "react-native";
import { screen } from "@react-native-harness/ui";

const COLORS = ['red', 'green', 'blue', 'yellow', 'purple', 'orange', 'pink', 'brown', 'gray', 'black'];

describe('Out of bounds', () => {
  	test('should screenshot specific element only', async () => {
		await render(
		<View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
			<View testID="out-of-bounds" style={{ width: 1000, height: 100, backgroundColor: 'yellow', flexDirection: 'row' }}>
				{Array.from({ length: 10 }).map((_, index) => (
					<View key={index} style={{ width: 100, height: 100, backgroundColor: COLORS[index % COLORS.length] }} />
				))}
			</View>
		</View>
		);

		const element = await screen.findByTestId('out-of-bounds');
		const screenshot = await screen.screenshot(element);
		await expect(screenshot).toMatchImageSnapshot({
			name: 'out-of-bounds',
		});
	});
});