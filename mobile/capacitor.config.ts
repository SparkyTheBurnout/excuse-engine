
import { CapacitorConfig } from '@capacitor/core';

const config: CapacitorConfig = {
  appId: 'com.excuseengine.app',
  appName: 'Excuse Engine',
  webDir: 'www',
  server: {
    androidScheme: 'https',
    url: 'https://4203aec3-cdb5-469e-b9a2-80eff69e059d-00-2chmp43hm4exv.janeway.replit.dev'
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: "#1a1a1a",
      showSpinner: false
    },
    StatusBar: {
      style: 'DARK'
    },
    App: {
      launchUrl: 'https://4203aec3-cdb5-469e-b9a2-80eff69e059d-00-2chmp43hm4exv.janeway.replit.dev'
    }
  }
};

export default config;
