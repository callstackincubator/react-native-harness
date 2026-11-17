import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { formatGreeting } from '@app/lib/greeting';
import logo from '@app/assets/logo.svg';

export const App = () => {
  const [count, setCount] = useState(0);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{formatGreeting('Harness')}</Text>
      <Image source={{ uri: logo }} style={styles.logo} />
      <Pressable
        role="button"
        aria-label={`Pressed ${count} times`}
        onPress={() => setCount((value) => value + 1)}
        style={styles.button}
      >
        <Text style={styles.buttonText}>Pressed {count} times</Text>
      </Pressable>
      <Text>Build: {__BUILD_LABEL__}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    backgroundColor: 'white',
  },
  title: { fontSize: 24, fontWeight: 'bold' },
  logo: { width: 96, height: 96 },
  button: { padding: 12, borderRadius: 8, backgroundColor: '#1c78c0' },
  buttonText: { color: 'white' },
});
