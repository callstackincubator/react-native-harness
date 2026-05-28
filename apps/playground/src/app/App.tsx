import {
  Alert,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import PlaygroundCrash from '../native/PlaygroundCrash';

type CrashAction = {
  description: string;
  label: string;
  onPress: () => void;
};

const iosCrashActions: CrashAction[] = [
  {
    label: 'Objective-C Sync',
    description: 'Throws NSException inside TurboModule call path',
    onPress: () => {
      PlaygroundCrash.crashFromObjectiveCSync('App.tsx objective-c sync');
    },
  },
  {
    label: 'Objective-C Async',
    description: 'Throws NSException on the main queue after return',
    onPress: () => {
      PlaygroundCrash.crashFromObjectiveCAsync('App.tsx objective-c async');
    },
  },
  {
    label: 'Swift Sync',
    description: 'Calls fatalError immediately in Swift',
    onPress: () => {
      PlaygroundCrash.crashFromSwiftSync('App.tsx swift sync');
    },
  },
  {
    label: 'Swift Async',
    description: 'Calls fatalError on the main queue after return',
    onPress: () => {
      PlaygroundCrash.crashFromSwiftAsync('App.tsx swift async');
    },
  },
];

const androidCrashActions: CrashAction[] = [
  {
    label: 'Kotlin Sync',
    description: 'Throws RuntimeException immediately in the TurboModule',
    onPress: () => {
      PlaygroundCrash.crashFromKotlinSync('App.tsx kotlin sync');
    },
  },
  {
    label: 'Kotlin Async',
    description: 'Throws RuntimeException on the main thread after return',
    onPress: () => {
      PlaygroundCrash.crashFromKotlinAsync('App.tsx kotlin async');
    },
  },
];

const unsupportedActions: CrashAction[] =
  Platform.OS === 'ios'
    ? androidCrashActions.map((action) => ({
        ...action,
        onPress: () => {
          Alert.alert('Unavailable on iOS', `${action.label} is Android-only.`);
        },
      }))
    : iosCrashActions.map((action) => ({
        ...action,
        onPress: () => {
          Alert.alert('Unavailable on Android', `${action.label} is iOS-only.`);
        },
      }));

const activeActions = Platform.OS === 'ios' ? iosCrashActions : androidCrashActions;

export const App = () => {
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Text style={styles.title}>Native Crash Playground</Text>
          <Text style={styles.subtitle}>
            Use these buttons to trigger each native crash path manually on{' '}
            {Platform.OS}.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Available on this device</Text>
          {activeActions.map((action) => (
            <Pressable key={action.label} onPress={action.onPress} style={styles.button}>
              <Text style={styles.buttonLabel}>{action.label}</Text>
              <Text style={styles.buttonDescription}>{action.description}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Other platform variants</Text>
          {unsupportedActions.map((action) => (
            <Pressable
              key={action.label}
              onPress={action.onPress}
              style={[styles.button, styles.buttonDisabled]}
            >
              <Text style={styles.buttonLabel}>{action.label}</Text>
              <Text style={styles.buttonDescription}>{action.description}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#111827',
  },
  content: {
    padding: 20,
    gap: 24,
  },
  hero: {
    gap: 8,
  },
  title: {
    color: '#f9fafb',
    fontSize: 28,
    fontWeight: '700',
  },
  subtitle: {
    color: '#d1d5db',
    fontSize: 15,
    lineHeight: 22,
  },
  section: {
    gap: 12,
  },
  sectionTitle: {
    color: '#f9fafb',
    fontSize: 18,
    fontWeight: '600',
  },
  button: {
    backgroundColor: '#1f2937',
    borderColor: '#374151',
    borderRadius: 16,
    borderWidth: 1,
    gap: 6,
    padding: 16,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonLabel: {
    color: '#f9fafb',
    fontSize: 16,
    fontWeight: '600',
  },
  buttonDescription: {
    color: '#9ca3af',
    fontSize: 14,
    lineHeight: 20,
  },
});

export default App;
