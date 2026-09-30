export function isPrivateIPv4(address: string): boolean;
export function collectDevHttpsHosts(
  interfaces: NodeJS.Dict<
    readonly { address: string; family: string | number; internal: boolean }[]
  >,
): string[];
