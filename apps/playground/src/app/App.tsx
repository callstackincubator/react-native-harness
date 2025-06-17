import { View, Text, StyleSheet } from 'react-native';

export const App = () => {
  return (
    <View style={styles.root}>
      <Text>Hello from the playground!</Text>
    </View>
  );
};
const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default App;
