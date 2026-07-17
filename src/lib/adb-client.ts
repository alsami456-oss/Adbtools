import { Adb, AdbDaemonTransport } from "@yume-chan/adb";
import {
  AdbDaemonWebUsbDeviceManager,
  type AdbDaemonWebUsbDevice,
} from "@yume-chan/adb-daemon-webusb";
import { ReadableStream } from "@yume-chan/stream-extra";

export type AdbConnection = {
  adb: Adb;
  device: AdbDaemonWebUsbDevice;
  close: () => Promise<void>;
};

// Minimal ADB credential store — persists an RSA key in localStorage so the
// device only needs to authorize the browser once.
class SimpleCredentialStore {
  private readonly storageKey = "webadb-private-key";

  async *iterateKeys() {
    const stored = localStorage.getItem(this.storageKey);
    if (stored) {
      yield { buffer: this.decode(stored), name: "webadb" };
    }
  }

  async generateKey() {
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
    return { buffer: bytes, name: "webadb" };
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

export function isWebUsbSupported(): boolean {
  return typeof navigator !== "undefined" && !!(navigator as unknown as { usb?: unknown }).usb;
}

export async function requestDevice(): Promise<AdbDaemonWebUsbDevice | null> {
  const manager = AdbDaemonWebUsbDeviceManager.BROWSER;
  if (!manager) throw new Error("WebUSB غير مدعوم في هذا المتصفح. استخدم Chrome أو Edge.");
  const device = await manager.requestDevice();
  return device ?? null;
}

export async function connect(device: AdbDaemonWebUsbDevice): Promise<AdbConnection> {
  const connection = await device.connect();
  const credentialStore = new SimpleCredentialStore();

  const transport = await AdbDaemonTransport.authenticate({
    serial: device.serial,
    connection,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    credentialStore: credentialStore as any,
  });

  const adb = new Adb(transport);
  return {
    adb,
    device,
    close: async () => {
      try {
        await adb.close();
      } catch {
        /* ignore */
      }
    },
  };
}

export async function runShell(adb: Adb, command: string): Promise<string> {
  const proc = await adb.subprocess.noneProtocol.spawn(command);
  const reader = proc.output.getReader();
  const decoder = new TextDecoder();
  let out = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

// Push a file via ADB sync, then `pm install` it. Works on Android Auto / AAOS.
export async function installApk(
  adb: Adb,
  file: File,
  onProgress?: (loaded: number, total: number) => void,
): Promise<string> {
  const sync = await adb.sync();
  try {
    const remotePath = `/data/local/tmp/${sanitize(file.name)}`;
    const total = file.size;
    let loaded = 0;

    const source = file.stream() as unknown as ReadableStream<Uint8Array>;
    const tracked = new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = source.getReader();
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

    await sync.write({
      filename: remotePath,
      file: tracked,
    });

    const result = await runShell(adb, `pm install -r -g "${remotePath}"`);
    await runShell(adb, `rm -f "${remotePath}"`);
    return result.trim();
  } finally {
    await sync.dispose();
  }
}

function sanitize(name: string): string {
  return name.replace(/[^\w.\-]+/g, "_");
}

export async function listInstalledPackages(
  adb: Adb,
  filter: "all" | "third-party" | "system" = "all",
): Promise<string[]> {
  const flag = filter === "third-party" ? "-3" : filter === "system" ? "-s" : "";
  const out = await runShell(adb, `pm list packages ${flag}`.trim());
  return out
    .split("\n")
    .map((l) => l.replace(/^package:/, "").trim())
    .filter(Boolean)
    .sort();
}

export async function grantPermission(adb: Adb, pkg: string, permission: string): Promise<string> {
  return runShell(adb, `pm grant ${pkg} ${permission}`);
}

// Read all runtime permissions the package declares in its manifest.
export async function getRequestedPermissions(adb: Adb, pkg: string): Promise<string[]> {
  const out = await runShell(adb, `dumpsys package ${pkg}`);
  const perms = new Set<string>();

  // "requested permissions:" block — one permission per line.
  const reqMatch = out.match(/requested permissions:\s*([\s\S]*?)(?:\n\s*\n|install permissions:|runtime permissions:|$)/i);
  if (reqMatch) {
    for (const line of reqMatch[1].split("\n")) {
      const m = line.trim().match(/^([a-zA-Z0-9_.]+\.permission\.[A-Z0-9_]+)/);
      if (m) perms.add(m[1]);
    }
  }

  // "runtime permissions:" block — these are the dangerous ones we can grant.
  const runMatch = out.match(/runtime permissions:\s*([\s\S]*?)(?:\n\s*\n|$)/i);
  if (runMatch) {
    for (const line of runMatch[1].split("\n")) {
      const m = line.trim().match(/^([a-zA-Z0-9_.]+\.permission\.[A-Z0-9_]+):/);
      if (m) perms.add(m[1]);
    }
  }

  return Array.from(perms);
}

// Grant every runtime permission the package declares. Non-runtime perms
// will fail with "not a changeable permission" — we swallow those silently.
export async function grantAllPermissions(
  adb: Adb,
  pkg: string,
  onProgress?: (perm: string, ok: boolean, message: string) => void,
): Promise<{ granted: number; failed: number; total: number }> {
  const perms = await getRequestedPermissions(adb, pkg);
  let granted = 0;
  let failed = 0;
  for (const p of perms) {
    try {
      const r = await runShell(adb, `pm grant ${pkg} ${p}`);
      const msg = r.trim();
      // Non-runtime perms return an error message; treat empty as success.
      if (!msg || /^Success/i.test(msg)) {
        granted++;
        onProgress?.(p, true, "OK");
      } else {
        failed++;
        onProgress?.(p, false, msg);
      }
    } catch (e) {
      failed++;
      onProgress?.(p, false, (e as Error).message);
    }
  }
  return { granted, failed, total: perms.length };
}

export async function revokePermission(adb: Adb, pkg: string, permission: string): Promise<string> {
  return runShell(adb, `pm revoke ${pkg} ${permission}`);
}

export async function uninstallPackage(adb: Adb, pkg: string): Promise<string> {
  return runShell(adb, `pm uninstall ${pkg}`);
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
