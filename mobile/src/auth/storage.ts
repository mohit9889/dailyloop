import * as SecureStore from "expo-secure-store";
// Native secure values have size limits. Split by Unicode code point so a
// chunk is at most 1,400 UTF-8 bytes, and keep only a compact manifest.
type Manifest = { version: string; count: number };
const options = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};
const chunkSize = 350;
function parse(raw: string): Manifest {
  const value = JSON.parse(raw) as Manifest;
  if (
    typeof value.version !== "string" ||
    !/^[-a-z0-9]+$/.test(value.version) ||
    !Number.isInteger(value.count) ||
    value.count < 0 ||
    value.count > 300
  )
    throw new Error("Invalid stored session");
  return value;
}
const part = (key: string, m: Manifest, index: number) =>
  `${key}.${m.version}.${index}`;
async function removeParts(key: string, m: Manifest) {
  await Promise.all(
    Array.from({ length: m.count }, (_, i) =>
      SecureStore.deleteItemAsync(part(key, m, i), options),
    ),
  );
}
export const secureSessionStorage = {
  async getItem(key: string) {
    const raw = await SecureStore.getItemAsync(key, options);
    if (!raw) return null;
    const m = parse(raw);
    const values = await Promise.all(
      Array.from({ length: m.count }, (_, i) =>
        SecureStore.getItemAsync(part(key, m, i), options),
      ),
    );
    return values.some((v) => v === null) ? null : values.join("");
  },
  async setItem(key: string, value: string) {
    if (value.length > 100000)
      throw new Error("Session is too large to store securely");
    const previous = await SecureStore.getItemAsync(key, options);
    const points = Array.from(value);
    const m = {
      version: Date.now().toString(36) + Math.random().toString(36).slice(2),
      count: Math.ceil(points.length / chunkSize),
    };
    for (let i = 0; i < m.count; i++)
      await SecureStore.setItemAsync(
        part(key, m, i),
        points.slice(i * chunkSize, (i + 1) * chunkSize).join(""),
        options,
      );
    await SecureStore.setItemAsync(key, JSON.stringify(m), options);
    if (previous) await removeParts(key, parse(previous));
  },
  async removeItem(key: string) {
    const raw = await SecureStore.getItemAsync(key, options);
    await SecureStore.deleteItemAsync(key, options);
    if (raw) await removeParts(key, parse(raw));
  },
};
