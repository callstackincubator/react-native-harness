import React, { useState } from 'react';
import {
  describe,
  expect,
  render,
  test,
  waitUntil,
} from 'react-native-harness';
import { screen, userEvent } from '@react-native-harness/ui';
import { Platform, Pressable, Text, View } from 'react-native';
import { VisionCamera} from 'react-native-vision-camera';

describe('Permissions', () => {
  test('should allow camera permissions when requested', async () => {
    if (Platform.OS === 'web') {
      return;
    }

    const initialStatus = VisionCamera.cameraPermissionStatus;
    let latestStatus = initialStatus;

    const CameraPermissionTrigger = () => {
      const [status, setStatus] = useState(initialStatus);

      const handlePress = async () => {
        const wasGranted = await VisionCamera.requestCameraPermission();
        const nextStatus = wasGranted ? 'authorized' : 'denied';
        latestStatus = nextStatus;
        setStatus(nextStatus);
      };

      return (
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            gap: 16,
            backgroundColor: 'white',
          }}
        >
          <Text testID="camera-permission-status">{status}</Text>
          <Pressable
            testID="request-camera-permission"
            onPress={handlePress}
            style={{
              paddingHorizontal: 16,
              paddingVertical: 12,
              backgroundColor: 'black',
            }}
          >
            <Text style={{ color: 'white' }}>Request camera permission</Text>
          </Pressable>
        </View>
      );
    };

    await render(<CameraPermissionTrigger />);

    expect(initialStatus).not.toBe('denied');

    const requestButton = await screen.findByTestId(
      'request-camera-permission',
    );
    await userEvent.press(requestButton);

    await waitUntil(() => latestStatus === 'authorized', { timeout: 30000 });

    expect(latestStatus).toBe('authorized');
    expect(await screen.findByTestId('camera-permission-status')).toBeDefined();
  });
});
