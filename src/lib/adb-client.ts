import { Adb, AdbServerClient } from "@yume-chan/adb";
import {
  AdbDaemonWebUsbDeviceManager,
  AdbDaemonWebUsbDevice,
} from "@yume-chan/adb-daemon-webusb";
import { AdbDaemonTransport } from "@yume-chan/adb";
import AdbWebCredentialStore from "@yume-chan/adb-credential-web";
// Note: AdbWebCredentialStore is exported from the main package in v2
// but if not, we implement a minimal one below.
export type AdbConnection = {
  adb: Adb;
  device: AdbDaemonWebUsbDevice;
  close: () => Promise<void>;
};
// Minimal credential store using localStorage — required for auth handshake.
class SimpleCredentialStore {
  private readonly storageKey = "webadb-private-key";
  async *iterateKeys() {
    const stored = localStorage.getItem(this.storageKey);
    if (stored) {
      yield this.decode(stored);
    }
  }
  async generateKey(): Promise<Uint8Array> {
    // Use Web Crypto for RSA key pair
    const keyPair = await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-1",
      },
      true,
      ["sign", "verify"],
    );
    const pkcs8 = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
    const bytes = new Uint8Array(pkcs8);
    localStorage.setItem(this.storageKey, this.encode(bytes));
    return bytes;
  }
  private encode(bytes: Uint8Array): string {
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
  }
  private decode(str: string): Uint8Array {
    const s = atob(str);
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
    return bytes;
  }
}
export async function isWebUsbSupported(): Promise<boolean> {
  return typeof navigator !== "undefined" && !!(navigator as any).usb;
}
export async function requestDevice(): Promise<AdbDaemonWebUsbDevice | null> {
  const manager = AdbDaemonWebUsbDeviceManager.BROWSER;
  if (!manager) throw new Error("WebUSB غير مدعوم في هذا المتصفح");
  const device = await manager.requestDevice();
  return device ?? null;
}
export async function connect(
  device: AdbDaemonWebUsbDevice,
): Promise<AdbConnection> {
  const connection = await device.connect();
  const credentialStore = new SimpleCredentialStore() as any;
  const transport = await AdbDaemonTransport.authenticate({
    serial: device.serial,
    connection,
    credentialStore,
  });
  const adb = new Adb(transport);
  return {
    adb,
    device,
    close: async () => {
      await adb.close();
    },
  };
}
export async function runShell(adb: Adb, command: string): Promise<string> {
  const process = await adb.subprocess.noneProtocol.spawn(command);
  const reader = process.output.getReader();
  const chunks: Uint8Array[] = [];
  const decoder = new TextDecoder();
  let out = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) out += decoder.decode(value, { stream: true });
    chunks.push(value ?? new Uint8Array());
  }
  return out;
}
export async function installApk(
  adb: Adb,
  file: File,
  onProgress?: (loaded: number, total: number) => void,
): Promise<void> {
  const packageManager = new (await import("@yume-chan/adb")).PackageManager(adb);
  const stream = file.stream() as unknown as ReadableStream<Uint8Array>;
  let loaded = 0;
  const total = file.size;
  const progressed = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          loaded += value.byteLength;
          onProgress?.(loaded, total);
          controller.enqueue(value);
        }
      }
      controller.close();
    },
  });
  await packageManager.installStream(file.size, progressed);
}
export async function listInstalledPackages(adb: Adb): Promise<string[]> {
  const out = await runShell(adb, "pm list packages");
  return out
    .split("\n")
    .map((l) => l.replace(/^package:/, "").trim())
    .filter(Boolean)
    .sort();
}
export async function grantPermission(
  adb: Adb,
  pkg: string,
  permission: string,
): Promise<string> {
  return runShell(adb, `pm grant ${pkg} ${permission}`);
}
export async function revokePermission(
  adb: Adb,
  pkg: string,
  permission: string,
): Promise<string> {
  return runShell(adb, `pm revoke ${pkg} ${permission}`);
}
export const COMMON_PERMISSIONS = [
  "android.permission.ACCESS_FINE_LOCATION",
  "android.permission.ACCESS_COARSE_LOCATION",
  "android.permission.ACCESS_BACKGROUND_LOCATION",
  "android.permission.READ_EXTERNAL_STORAGE",
  "android.permission.WRITE_EXTERNAL_STORAGE",
  "android.permission.MANAGE_EXTERNAL_STORAGE",
  "android.permission.CAMERA",
  "android.permission.RECORD_AUDIO",
  "android.permission.READ_CONTACTS",
  "android.permission.WRITE_CONTACTS",
  "android.permission.READ_PHONE_STATE",
  "android.permission.CALL_PHONE",
  "android.permission.READ_SMS",
  "android.permission.SEND_SMS",
  "android.permission.BLUETOOTH_CONNECT",
  "android.permission.BLUETOOTH_SCAN",
  "android.permission.POST_NOTIFICATIONS",
  "android.permission.SYSTEM_ALERT_WINDOW",
];
