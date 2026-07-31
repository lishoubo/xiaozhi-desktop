type CommandLine = Readonly<{
  appendSwitch: (switchName: string, value: string) => void;
}>;

export function configureNetworkPrivacy(commandLine: CommandLine): void {
  commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'disable_non_proxied_udp');
}
