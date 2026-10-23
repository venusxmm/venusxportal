const releaseVersion = import.meta.env["VITE_APP_VERSION"];

export function resolveAppVersion(value: string | undefined): string {
  const version = value?.replace(/^v/, "");
  return version && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) ? version : "0.1.0";
}

export const APP_VERSION = resolveAppVersion(releaseVersion);

export const APP_VERSION_LABEL = `v${APP_VERSION}`;
