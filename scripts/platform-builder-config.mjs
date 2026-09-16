// Every target's metadata is supplied by the repository, never by the installer.
export function platformBuilderConfig(pkg, platform) {
  const description = pkg.alderSetup.descriptions[platform];
  if (!description) throw new Error(`Missing committed description for ${platform}`);
  return {
    ...pkg.build,
    extraMetadata: { ...pkg.build.extraMetadata, description },
    linux: {
      ...pkg.build.linux,
      description: pkg.alderSetup.descriptions.linux,
      desktop: {
        ...pkg.build.linux.desktop,
        entry: { ...pkg.build.linux.desktop?.entry, Comment: pkg.alderSetup.descriptions.linux },
      },
    },
    mac: {
      ...pkg.build.mac,
      extendInfo: { ...pkg.build.mac.extendInfo, CFBundleGetInfoString: pkg.alderSetup.descriptions.darwin },
    },
  };
}
