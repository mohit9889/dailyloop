import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
export function secretBox(base64Key: string) {
  const key = Buffer.from(base64Key, "base64");
  if (key.length !== 32) throw new Error("Session key must be 32 bytes.");
  return {
    seal(value: unknown) {
      const iv = randomBytes(12),
        cipher = createCipheriv("aes-256-gcm", key, iv);
      const encrypted = Buffer.concat([
        cipher.update(JSON.stringify(value), "utf8"),
        cipher.final(),
      ]);
      return [iv, cipher.getAuthTag(), encrypted]
        .map((b) => b.toString("base64url"))
        .join(".");
    },
    open<T>(value: string): T {
      const parts = value.split(".");
      if (parts.length !== 3) throw new Error("Invalid encrypted value");
      const [iv, tag, data] = parts.map((p) => Buffer.from(p, "base64url"));
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      return JSON.parse(
        Buffer.concat([decipher.update(data), decipher.final()]).toString(
          "utf8",
        ),
      ) as T;
    },
  };
}
