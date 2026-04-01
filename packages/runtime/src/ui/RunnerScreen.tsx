import {
  Image,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { CK_LOGO, POWERED_BY } from './images.js';

type RunnerScreenProps = {
  title: string;
  statusText: string;
  message?: string;
};

export const RunnerScreen = ({
  title,
  statusText,
  message,
}: RunnerScreenProps) => {
  return (
    <View style={styles.container}>
      <StatusBar hidden={true} />
      <View style={styles.topSpacer} />
      <View style={styles.content}>
        <Image source={{ uri: CK_LOGO }} style={styles.logo} resizeMode="cover" />
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.statusText}>{statusText}</Text>
        {message ? <Text style={styles.message}>{message}</Text> : null}
      </View>
      <View style={styles.footer}>
        <Image
          source={{ uri: POWERED_BY }}
          style={styles.poweredBy}
          resizeMode="contain"
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingVertical: 16,
  },
  topSpacer: {
    minHeight: 16,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  logo: {
    width: 64,
    height: 64,
    borderRadius: 14,
  },
  title: {
    marginTop: 16,
    fontSize: 28,
    fontWeight: '700',
    color: '#000',
    textAlign: 'center',
  },
  statusText: {
    marginTop: 12,
    fontSize: 16,
    fontWeight: '500',
    color: '#000',
    textAlign: 'center',
  },
  message: {
    marginTop: 12,
    maxWidth: 320,
    fontSize: 14,
    lineHeight: 20,
    color: '#000',
    textAlign: 'center',
  },
  footer: {
    padding: 16,
  },
  poweredBy: {
    width: 180,
    height: 44,
    opacity: 0.8,
  },
});
