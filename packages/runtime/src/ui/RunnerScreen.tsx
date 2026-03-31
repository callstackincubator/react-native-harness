import {
  Image,
  type ImageSourcePropType,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';

const logoImage =
  require('../../assets/runner-logo.jpg') as ImageSourcePropType;
const poweredByImage =
  require('../../assets/powered-by.png') as ImageSourcePropType;

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
        <Image source={logoImage} style={styles.logo} resizeMode="cover" />
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.statusText}>{statusText}</Text>
        {message ? <Text style={styles.message}>{message}</Text> : null}
      </View>
      <View style={styles.footer}>
        <Image
          source={poweredByImage}
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
    backgroundColor: '#0a1628',
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
    color: '#ffffff',
    textAlign: 'center',
  },
  statusText: {
    marginTop: 12,
    fontSize: 16,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.78)',
    textAlign: 'center',
  },
  message: {
    marginTop: 12,
    maxWidth: 320,
    fontSize: 14,
    lineHeight: 20,
    color: 'rgba(255, 255, 255, 0.62)',
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
