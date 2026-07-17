import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Adb } from "@yume-chan/adb";
import type { AdbDaemonWebUsbDevice } from "@yume-chan/adb-daemon-webusb";
import {
  COMMON_PERMISSIONS,
  connect,
  grantAllPermissions,
  grantPermission,
  installApk,
  isWebUsbSupported,
  listInstalledPackages,
  requestDevice,
  revokePermission,
  runShell,
  uninstallPackage,
  type AdbConnection,
} from "@/lib/adb-client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "CarADB — إدارة سيارات أندرويد عبر ADB" },
      {
        name: "description",
        content:
          "أداة ويب لتوصيل شاشات السيارات (Android Auto / AAOS) عبر ADB، تثبيت حزم APK، ومنح الأذونات مباشرة من المتصفح.",
      },
      { property: "og:title", content: "CarADB — إدارة سيارات أندرويد عبر ADB" },
      {
        property: "og:description",
        content: "توصيل، تثبيت APK، ومنح الأذونات من المتصفح باستخدام WebUSB.",
      },
    ],
  }),
  component: HomePage,
});

type LogLine = { time: string; text: string; kind: "info" | "ok" | "err" };

function HomePage() {
  const [supported, setSupported] = useState(true);
  const [conn, setConn] = useState<AdbConnection | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [packages, setPackages] = useState<string[]>([]);
  const [pkgFilter, setPkgFilter] = useState<"all" | "third-party" | "system">("third-party");
  const [pkgSearch, setPkgSearch] = useState("");
  const [selectedPkg, setSelectedPkg] = useState<string>("");
  const [permission, setPermission] = useState(COMMON_PERMISSIONS[0]);
  const [customCmd, setCustomCmd] = useState("");
  const [progress, setProgress] = useState<{ name: string; pct: number } | null>(null);
  const [bundle, setBundle] = useState<File[]>([]);
  const [bundleRunning, setBundleRunning] = useState(false);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSupported(isWebUsbSupported());
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [logs]);

  const log = useCallback((text: string, kind: LogLine["kind"] = "info") => {
    const time = new Date().toLocaleTimeString("ar-EG", { hour12: false });
    setLogs((l) => [...l.slice(-500), { time, text, kind }]);
  }, []);

  const doConnect = async () => {
    setConnecting(true);
    try {
      const device: AdbDaemonWebUsbDevice | null = await requestDevice();
      if (!device) {
        log("لم يتم اختيار جهاز.", "info");
        return;
      }
      log(`جاري الاتصال بـ ${device.serial}… وافق على طلب ADB على الشاشة.`);
      const c = await connect(device);
      setConn(c);
      log(`متصل بـ ${c.device.serial}`, "ok");
      await refreshPackages(c.adb, pkgFilter);
    } catch (e) {
      log(`فشل الاتصال: ${(e as Error).message}`, "err");
    } finally {
      setConnecting(false);
    }
  };

  const doDisconnect = async () => {
    if (!conn) return;
    await conn.close();
    setConn(null);
    setPackages([]);
    setSelectedPkg("");
    log("تم قطع الاتصال.", "info");
  };

  const refreshPackages = async (
    adb: Adb,
    filter: "all" | "third-party" | "system" = pkgFilter,
  ) => {
    setBusy(true);
    try {
      const list = await listInstalledPackages(adb, filter);
      setPackages(list);
      if (!list.includes(selectedPkg)) setSelectedPkg(list[0] ?? "");
      log(`تم جلب ${list.length} حزمة (${filter}).`, "ok");
    } catch (e) {
      log(`فشل جلب الحزم: ${(e as Error).message}`, "err");
    } finally {
      setBusy(false);
    }
  };

  const onInstall = async (files: FileList | null) => {
    if (!conn || !files || files.length === 0) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        if (!file.name.toLowerCase().endsWith(".apk")) {
          log(`تخطي ${file.name}: ليس ملف APK.`, "info");
          continue;
        }
        setProgress({ name: file.name, pct: 0 });
        log(`رفع ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB)…`);
        const result = await installApk(conn.adb, file, (loaded, total) =>
          setProgress({ name: file.name, pct: Math.round((loaded / total) * 100) }),
        );
        log(`نتيجة ${file.name}: ${result || "Success"}`, result.includes("Success") ? "ok" : "err");
      }
      setProgress(null);
      await refreshPackages(conn.adb);
    } catch (e) {
      log(`فشل التثبيت: ${(e as Error).message}`, "err");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const onGrant = async () => {
    if (!conn || !selectedPkg) return;
    setBusy(true);
    try {
      const r = await grantPermission(conn.adb, selectedPkg, permission);
      log(`grant ${permission} → ${selectedPkg}: ${r || "OK"}`, "ok");
    } catch (e) {
      log((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  const onRevoke = async () => {
    if (!conn || !selectedPkg) return;
    setBusy(true);
    try {
      const r = await revokePermission(conn.adb, selectedPkg, permission);
      log(`revoke ${permission} → ${selectedPkg}: ${r || "OK"}`, "ok");
    } catch (e) {
      log((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  const onGrantAll = async () => {
    if (!conn || !selectedPkg) return;
    setBusy(true);
    try {
      log(`جلب الأذونات المطلوبة لـ ${selectedPkg}…`);
      const res = await grantAllPermissions(conn.adb, selectedPkg, (p, ok, msg) => {
        log(`  ${ok ? "✓" : "✗"} ${p.replace("android.permission.", "")}${ok ? "" : ` — ${msg}`}`, ok ? "ok" : "info");
      });
      log(
        `تم منح ${res.granted}/${res.total} إذن لـ ${selectedPkg} (فشل ${res.failed}).`,
        res.failed === 0 ? "ok" : "info",
      );
    } catch (e) {
      log((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  const onAddBundleFiles = (files: FileList | null) => {
    if (!files) return;
    const apks = Array.from(files).filter((f) => f.name.toLowerCase().endsWith(".apk"));
    setBundle((prev) => {
      const seen = new Set(prev.map((f) => f.name + f.size));
      return [...prev, ...apks.filter((f) => !seen.has(f.name + f.size))];
    });
  };

  const onInstallBundle = async () => {
    if (!conn || bundle.length === 0) return;
    setBundleRunning(true);
    setBusy(true);
    let ok = 0;
    let fail = 0;
    try {
      for (let i = 0; i < bundle.length; i++) {
        const file = bundle[i];
        setProgress({ name: `(${i + 1}/${bundle.length}) ${file.name}`, pct: 0 });
        log(`تثبيت ${file.name}…`);
        try {
          const result = await installApk(conn.adb, file, (loaded, total) =>
            setProgress({
              name: `(${i + 1}/${bundle.length}) ${file.name}`,
              pct: Math.round((loaded / total) * 100),
            }),
          );
          const success = result.includes("Success") || !result;
          log(`${file.name}: ${result || "Success"}`, success ? "ok" : "err");
          success ? ok++ : fail++;
        } catch (e) {
          fail++;
          log(`${file.name}: ${(e as Error).message}`, "err");
        }
      }
      log(`انتهت الحزمة: ${ok} نجاح، ${fail} فشل من ${bundle.length}.`, fail === 0 ? "ok" : "info");
      await refreshPackages(conn.adb);
    } finally {
      setProgress(null);
      setBundleRunning(false);
      setBusy(false);
    }
  };

  const onUninstall = async () => {
    if (!conn || !selectedPkg) return;
    if (!confirm(`حذف الحزمة ${selectedPkg}؟`)) return;
    setBusy(true);
    try {
      const r = await uninstallPackage(conn.adb, selectedPkg);
      log(`uninstall ${selectedPkg}: ${r || "OK"}`, "ok");
      await refreshPackages(conn.adb);
    } catch (e) {
      log((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  const onRunCustom = async () => {
    if (!conn || !customCmd.trim()) return;
    setBusy(true);
    try {
      log(`$ ${customCmd}`);
      const r = await runShell(conn.adb, customCmd);
      log(r || "(no output)", "ok");
    } catch (e) {
      log((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  const filteredPkgs = packages.filter((p) => p.includes(pkgSearch.toLowerCase()));

  return (
    <div dir="rtl" className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <div>
            <h1 className="text-xl font-bold">CarADB</h1>
            <p className="text-xs text-muted-foreground">
              إدارة شاشات السيارات (Android Auto / AAOS) عبر ADB مباشرة من المتصفح
            </p>
          </div>
          <div className="flex items-center gap-2">
            {conn ? (
              <>
                <span className="rounded-full bg-green-500/10 px-3 py-1 text-xs text-green-600">
                  متصل: {conn.device.serial}
                </span>
                <button
                  onClick={doDisconnect}
                  className="rounded-md border border-input px-3 py-1.5 text-sm hover:bg-accent"
                >
                  قطع الاتصال
                </button>
              </>
            ) : (
              <button
                onClick={doConnect}
                disabled={!supported || connecting}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {connecting ? "جاري الاتصال…" : "توصيل جهاز USB"}
              </button>
            )}
          </div>
        </div>
      </header>

      {!supported && (
        <div className="mx-auto mt-4 max-w-6xl rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          متصفحك لا يدعم WebUSB. استخدم Chrome أو Edge على كمبيوتر (سطح مكتب).
        </div>
      )}

      <main className="mx-auto grid max-w-6xl gap-4 p-4 lg:grid-cols-3">
        {/* Install */}
        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-2 font-semibold">تثبيت حزم APK</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            يمكن اختيار حزمة كاملة (عدة APK). سيتم رفعها للجهاز وتشغيل <code>pm install</code>.
          </p>
          <label
            className={`flex cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed border-input px-4 py-8 text-center text-sm hover:bg-accent ${
              !conn ? "pointer-events-none opacity-50" : ""
            }`}
          >
            <input
              type="file"
              accept=".apk,application/vnd.android.package-archive"
              multiple
              className="hidden"
              onChange={(e) => onInstall(e.target.files)}
            />
            <span className="font-medium">اسحب ملفات APK هنا أو اضغط للاختيار</span>
            <span className="mt-1 text-xs text-muted-foreground">يدعم اختيار متعدد</span>
          </label>
          {progress && (
            <div className="mt-3">
              <div className="mb-1 flex justify-between text-xs">
                <span className="truncate">{progress.name}</span>
                <span>{progress.pct}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${progress.pct}%` }}
                />
              </div>
            </div>
          )}
        </section>

        {/* Packages */}
        <section className="rounded-lg border border-border bg-card p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold">الحزم المثبتة</h2>
            <button
              disabled={!conn || busy}
              onClick={() => conn && refreshPackages(conn.adb)}
              className="rounded-md border border-input px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
            >
              تحديث
            </button>
          </div>
          <div className="mb-2 flex gap-1 text-xs">
            {(["third-party", "system", "all"] as const).map((f) => (
              <button
                key={f}
                onClick={() => {
                  setPkgFilter(f);
                  if (conn) refreshPackages(conn.adb, f);
                }}
                className={`rounded-md px-2 py-1 ${
                  pkgFilter === f
                    ? "bg-primary text-primary-foreground"
                    : "border border-input hover:bg-accent"
                }`}
              >
                {f === "third-party" ? "طرف ثالث" : f === "system" ? "نظام" : "الكل"}
              </button>
            ))}
          </div>
          <input
            type="text"
            placeholder="ابحث…"
            value={pkgSearch}
            onChange={(e) => setPkgSearch(e.target.value)}
            className="mb-2 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          />
          <select
            size={8}
            value={selectedPkg}
            onChange={(e) => setSelectedPkg(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-2 py-1 font-mono text-xs"
          >
            {filteredPkgs.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <div className="mt-2 text-xs text-muted-foreground">
            {filteredPkgs.length} / {packages.length}
          </div>
          <button
            onClick={onUninstall}
            disabled={!conn || !selectedPkg || busy}
            className="mt-2 w-full rounded-md border border-destructive/30 px-2 py-1.5 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
          >
            إلغاء تثبيت الحزمة المحددة
          </button>
        </section>

        {/* Permissions */}
        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-2 font-semibold">الأذونات</h2>
          <label className="mb-1 block text-xs text-muted-foreground">الحزمة المستهدفة</label>
          <input
            value={selectedPkg}
            onChange={(e) => setSelectedPkg(e.target.value)}
            placeholder="com.example.app"
            className="mb-2 w-full rounded-md border border-input bg-background px-2 py-1.5 font-mono text-xs"
          />
          <label className="mb-1 block text-xs text-muted-foreground">الإذن</label>
          <select
            value={permission}
            onChange={(e) => setPermission(e.target.value)}
            className="mb-2 w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs"
          >
            {COMMON_PERMISSIONS.map((p) => (
              <option key={p} value={p}>
                {p.replace("android.permission.", "")}
              </option>
            ))}
          </select>
          <input
            value={permission}
            onChange={(e) => setPermission(e.target.value)}
            className="mb-2 w-full rounded-md border border-input bg-background px-2 py-1.5 font-mono text-xs"
          />
          <div className="flex gap-2">
            <button
              onClick={onGrant}
              disabled={!conn || !selectedPkg || busy}
              className="flex-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              منح
            </button>
            <button
              onClick={onRevoke}
              disabled={!conn || !selectedPkg || busy}
              className="flex-1 rounded-md border border-input px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
            >
              سحب
            </button>
          </div>
          <button
            onClick={onGrantAll}
            disabled={!conn || !selectedPkg || busy}
            className="mt-2 w-full rounded-md bg-green-600 px-3 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
          >
            ⚡ منح جميع الأذونات دفعة واحدة
          </button>
          <p className="mt-1 text-[11px] text-muted-foreground">
            يقرأ الأذونات المطلوبة من manifest التطبيق ويمنحها كلها.
          </p>
        </section>

        {/* App Bundle */}
        <section className="rounded-lg border border-border bg-card p-4 lg:col-span-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold">حزمة تطبيقات — تثبيت تلقائي</h2>
            <div className="flex gap-2">
              <label className="cursor-pointer rounded-md border border-input px-3 py-1.5 text-xs hover:bg-accent">
                <input
                  type="file"
                  accept=".apk,application/vnd.android.package-archive"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    onAddBundleFiles(e.target.files);
                    e.currentTarget.value = "";
                  }}
                />
                + إضافة APK للحزمة
              </label>
              <button
                onClick={() => setBundle([])}
                disabled={bundle.length === 0 || bundleRunning}
                className="rounded-md border border-input px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
              >
                مسح
              </button>
              <button
                onClick={onInstallBundle}
                disabled={!conn || bundle.length === 0 || bundleRunning}
                className="rounded-md bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {bundleRunning ? "جاري التثبيت…" : `تثبيت الكل (${bundle.length})`}
              </button>
            </div>
          </div>
          {bundle.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              أضف ملفات APK لتكوين حزمتك، ثم اضغط "تثبيت الكل" لتثبيتها واحداً تلو الآخر تلقائياً.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {bundle.map((f, i) => (
                <li key={f.name + i} className="flex items-center justify-between px-3 py-2 text-xs">
                  <span className="truncate font-mono">
                    {i + 1}. {f.name}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="text-muted-foreground">
                      {(f.size / 1024 / 1024).toFixed(1)}MB
                    </span>
                    <button
                      onClick={() => setBundle((b) => b.filter((_, j) => j !== i))}
                      disabled={bundleRunning}
                      className="text-destructive hover:underline disabled:opacity-50"
                    >
                      حذف
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>


        {/* Custom shell */}
        <section className="rounded-lg border border-border bg-card p-4 lg:col-span-3">
          <h2 className="mb-2 font-semibold">أمر shell مخصص</h2>
          <div className="flex gap-2">
            <input
              value={customCmd}
              onChange={(e) => setCustomCmd(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onRunCustom()}
              placeholder="getprop ro.product.model"
              className="flex-1 rounded-md border border-input bg-background px-3 py-2 font-mono text-sm"
              dir="ltr"
            />
            <button
              onClick={onRunCustom}
              disabled={!conn || busy}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              تنفيذ
            </button>
          </div>
        </section>

        {/* Log */}
        <section className="rounded-lg border border-border bg-card p-4 lg:col-span-3">
          <h2 className="mb-2 font-semibold">السجل</h2>
          <div
            ref={logRef}
            dir="ltr"
            className="h-72 overflow-auto rounded-md bg-muted p-2 font-mono text-xs"
          >
            {logs.length === 0 ? (
              <div className="text-muted-foreground">لا توجد سجلات بعد.</div>
            ) : (
              logs.map((l, i) => (
                <div
                  key={i}
                  className={
                    l.kind === "err"
                      ? "text-destructive"
                      : l.kind === "ok"
                        ? "text-green-600"
                        : ""
                  }
                >
                  <span className="text-muted-foreground">[{l.time}]</span>{" "}
                  <span className="whitespace-pre-wrap">{l.text}</span>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card p-4 lg:col-span-3">
          <h2 className="mb-2 font-semibold">تعليمات مهمة</h2>
          <ol className="list-inside list-decimal space-y-1 text-sm text-muted-foreground">
            <li>يجب استخدام Chrome أو Edge على كمبيوتر (WebUSB لا يعمل على iOS).</li>
            <li>
              على شاشة السيارة/الجهاز: فعّل <b>Developer Options</b> ثم <b>USB debugging</b>.
              لبعض شاشات AAOS: فعّل <b>ADB over USB</b> من قائمة المطور.
            </li>
            <li>وصّل كابل USB بين الكمبيوتر وشاشة السيارة، اضغط "توصيل جهاز USB" واختره.</li>
            <li>عند أول اتصال ستظهر رسالة "Allow USB debugging?" على الشاشة — اقبلها.</li>
            <li>
              على ويندوز قد تحتاج تعريف <i>Google USB Driver</i> أو WinUSB عبر Zadig ليظهر
              الجهاز في المتصفح.
            </li>
          </ol>
        </section>
      </main>
    </div>
  );
}
