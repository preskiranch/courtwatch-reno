import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.preskiranch.courtwatchaau",
  appName: "Court Watch AAU",
  webDir: "apps/ios-shell/www",
  server: {
    url: "https://www.courtwatchaau.com",
    cleartext: false
  },
  ios: {
    contentInset: "automatic"
  }
};

export default config;
