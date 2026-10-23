const releaseVersion = import.meta.env["VITE_APP_VERSION"];

export const APP_VERSION =
  releaseVersion && /^0\.[0-9]+\.[0-9]+$/.test(releaseVersion) ? releaseVersion : "0.1.0";

export const APP_VERSION_LABEL = `v${APP_VERSION}`;
