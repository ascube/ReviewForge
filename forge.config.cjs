module.exports = {
  packagerConfig: {
    ...(require("node:fs").existsSync(
      ".cache/electron/electron-v45.2.3-darwin-arm64.zip",
    ) && process.platform === "darwin"
      ? { electronZipDir: require("node:path").resolve(".cache/electron") }
      : {}),
    name: "ReviewForge Desktop",
    executableName: "ReviewForgeDesktop",
    icon: "assets/icon",
    appBundleId: "dev.reviewforge.desktop",
    asar: { unpack: "**/node_modules/**/*" },
    ignore: [
      /^\/\.cache($|\/)/,
      /^\/src($|\/)/,
      /^\/\.git($|\/)/,
      /^\/tests($|\/)/,
      /^\/scripts($|\/)/,
      /^\/\.github($|\/)/,
      /^\/\.test-data($|\/)/,
      /^\/out($|\/)/,
    ],
    ...(process.env.APPLE_SIGN_IDENTITY
      ? { osxSign: { identity: process.env.APPLE_SIGN_IDENTITY } }
      : {}),
    ...(process.env.APPLE_API_KEY
      ? {
          osxNotarize: {
            appleApiKey: process.env.APPLE_API_KEY,
            appleApiKeyId: process.env.APPLE_API_KEY_ID,
            appleApiIssuer: process.env.APPLE_API_ISSUER,
          },
        }
      : {}),
  },
  makers: [
    {
      name: "@electron-forge/maker-dmg",
      platforms: ["darwin"],
      config: { format: "ULFO" },
    },
    {
      name: "@electron-forge/maker-squirrel",
      platforms: ["win32"],
      config: {
        name: "ReviewForgeDesktop",
        ...(process.env.WINDOWS_CERTIFICATE
          ? {
              certificateFile: process.env.WINDOWS_CERTIFICATE,
              certificatePassword: process.env.WINDOWS_CERTIFICATE_PASSWORD,
            }
          : {}),
      },
    },
    { name: "@electron-forge/maker-zip", platforms: ["darwin", "win32"] },
  ],
};
