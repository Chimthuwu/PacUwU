export {};

declare global {
  interface Window {
    electron?: {
      isElectron: boolean;
      platform: string;
      versions: {
        electron: string;
        chrome: string;
        node: string;
      };
    };
  }
}
