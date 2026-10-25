import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { lookup } from "node:dns/promises";
import { promisify } from "node:util";
import ipaddr from "ipaddr.js";

const derive = promisify(scrypt);
export const token = () => randomBytes(32).toString("base64url");
export const digest = (s: string) =>
  createHash("sha256").update(s).digest("hex");
export function same(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function encryptSecret(value: string, key: Buffer) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data]
    .map((v) => v.toString("base64url"))
    .join(".");
}
export function decryptSecret(value: string, key: Buffer) {
  const [iv, tag, data] = value
    .split(".")
    .map((v) => Buffer.from(v, "base64url"));
  const cipher = createDecipheriv("aes-256-gcm", key, iv);
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(data), cipher.final()]).toString("utf8");
}
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = (await derive(password, salt, 64)) as Buffer;
  return `${salt}:${hash.toString("hex")}`;
}
export async function verifyPassword(password: string, value: string) {
  try {
    const [salt, hash] = value.split(":");
    return same(
      ((await derive(password, salt, 64)) as Buffer).toString("hex"),
      hash,
    );
  } catch {
    return false;
  }
}
export function isPublicAddress(address: string) {
  try {
    let parsed = ipaddr.parse(address);
    if (
      parsed.kind() === "ipv6" &&
      (parsed as ipaddr.IPv6).isIPv4MappedAddress()
    )
      parsed = (parsed as ipaddr.IPv6).toIPv4Address();
    return parsed.range() === "unicast";
  } catch {
    return false;
  }
}
type Address = { address: string; family: number };
export async function resolvePublic(
  hostname: string,
  resolver: (hostname: string) => Promise<Address[]> = (h) =>
    lookup(h, { all: true, verbatim: true }),
) {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  )
    throw new Error("Upstream must be a public HTTPS endpoint");
  const addresses = ipaddr.isValid(host)
    ? [{ address: host, family: ipaddr.parse(host).kind() === "ipv4" ? 4 : 6 }]
    : await resolver(host);
  if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address)))
    throw new Error("Upstream resolves to a restricted address");
  return addresses;
}
export async function validatePublicUrl(
  value: string,
  resolver?: (hostname: string) => Promise<Address[]>,
) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    (url.port && url.port !== "443")
  )
    throw new Error(
      "Use a public HTTPS base URL on port 443 without credentials, query or fragment",
    );
  await resolvePublic(url.hostname, resolver);
  return url;
}
