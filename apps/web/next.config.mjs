import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDirectory = path.dirname(fileURLToPath(import.meta.url));
const appTarget =
  process.env.NEXT_PUBLIC_APP_TARGET === "courtvision"
    ? "app-target-courtvision.ts"
    : "app-target-courtwatch.ts";
const appTargetPath = path.join(
  projectDirectory,
  "src",
  "components",
  appTarget,
);
const appTargetProjectPath = `./src/components/${appTarget}`;

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  turbopack: {
    resolveAlias: {
      "@courtwatch/app-target": appTargetProjectPath,
    },
  },
  webpack(config) {
    config.resolve ??= {};
    config.resolve.alias ??= {};
    config.resolve.alias["@courtwatch/app-target"] = appTargetPath;
    return config;
  },
};

export default nextConfig;
