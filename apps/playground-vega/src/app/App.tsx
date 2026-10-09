import { StyleSheet, Text, View } from 'react-native';

export const App = () => {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Harness Playground for Vega</Text>
      <Text style={styles.subtitle}>
        React Native Harness replaces this screen with its own entry point
        while tests run.
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111827',
    gap: 12,
    padding: 40,
  },
  title: {
    color: '#f9fafb',
    fontSize: 36,
    fontWeight: '700',
  },
  subtitle: {
    color: '#d1d5db',
    fontSize: 20,
    textAlign: 'center',
  },
});

export default App;
