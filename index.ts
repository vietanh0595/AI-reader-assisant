import { registerRootComponent } from 'expo';
import * as Sentry from '@sentry/react-native';

import App from './App';

const sentryDsn = process.env.EXPO_PUBLIC_SENTRY_DSN?.trim();

// No DSN (e.g. local dev without one configured) means Sentry stays fully inert -
// `enabled: false` skips network calls/native init rather than just omitting a
// project that would otherwise error trying to send to an empty dsn.
Sentry.init({
  dsn: sentryDsn || undefined,
  enabled: Boolean(sentryDsn),
  tracesSampleRate: 1.0,
});

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(Sentry.wrap(App));
