import {
  View,
  Text,
  Image,
  StyleSheet,
  Platform,
  StatusBar,
} from 'react-native';
import { LOGO_IMAGE } from '../constants.js';

export const WrongEnvironmentScreen = () => {
  return (
    <View style={styles.container}>
      <View style={styles.contentContainer}>
        <View style={styles.logoContainer}>
          <Image style={styles.logo} source={LOGO_IMAGE} />
        </View>
        <Text style={styles.title}>React Native Harness</Text>

        <View style={styles.errorIndicator}>
          <View style={styles.errorDot} />
          <Text style={styles.errorText}>Environment Error</Text>
        </View>
        <Text style={styles.submessage}>
          Please double-check that you followed the installation documentation
          carefully.
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0a1628',
    position: 'relative',
  },
  safeArea: {
    flex: 1,
    backgroundColor: 'transparent',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  contentContainer: {
    alignItems: 'center',
    padding: 24,
    borderRadius: 24,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.2)',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 20,
    },
    shadowOpacity: 0.3,
    shadowRadius: 30,
    maxWidth: 350,
  },
  logoContainer: {
    marginBottom: 12,
  },
  logo: {
    width: 128,
    height: 128,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#38bdf8',
    textAlign: 'center',
    letterSpacing: 1,
    marginBottom: 8,
  },
  errorIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    height: 36,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.4)',
    marginBottom: 24,
  },
  errorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ef4444',
    marginRight: 8,
    shadowColor: '#ef4444',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
  },
  errorText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#ef4444',
    letterSpacing: 0.5,
  },
  submessage: {
    fontSize: 14,
    fontWeight: '400',
    color: 'rgba(255, 255, 255, 0.6)',
    textAlign: 'center',
    letterSpacing: 0.5,
  },
});
