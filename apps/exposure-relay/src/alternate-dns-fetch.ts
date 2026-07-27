import { lookup as dnsLookup } from "node:dns";
import { Agent, fetch as undiciFetch } from "undici";
import type { FetchLike } from "./upstream-router.js";

export function createAlternateDnsFetch(
  alternateDnsHostname: string,
): FetchLike {
  const hostname = alternateDnsHostname.trim();
  if (!hostname) {
    throw new Error("Alternate DNS hostname is required.");
  }

  const dispatcher = new Agent({
    connect: {
      lookup: (_requestedHostname, options, callback) => {
        dnsLookup(hostname, options, callback);
      },
    },
  });

  return async (url, init) =>
    (await undiciFetch(url, {
      ...init,
      dispatcher,
    } as Parameters<typeof undiciFetch>[1])) as unknown as Response;
}
