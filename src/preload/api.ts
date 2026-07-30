export type DesktopApi = Readonly<{
  versions: Readonly<{
    chrome: string;
    electron: string;
    node: string;
  }>;
}>;

type RuntimeVersions = Readonly<{
  chrome: string;
  electron: string;
  node: string;
}>;

export function createDesktopApi(versions: RuntimeVersions): DesktopApi {
  return Object.freeze({
    versions: Object.freeze({
      chrome: versions.chrome,
      electron: versions.electron,
      node: versions.node,
    }),
  });
}
