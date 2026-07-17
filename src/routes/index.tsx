import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Adb } from "@yume-chan/adb";
import type { AdbDaemonWebUsbDevice } from "@yume-chan/adb-daemon-webusb";
import {
  Usb,
  Plug,
  PlugZap,
  Upload,
  Package,
  RefreshCw,
  Search,
  Trash2,
  ShieldCheck,
  ShieldX,
  Zap,
  Layers,
  Plus,
  Play,
  Terminal,
  ScrollText,
  Info,
  CheckCircle2,
  XCircle,
  Car,
  Loader2,
} from "lucide-react";
import {
  COMMON_PERMISSIONS,
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
    <div dir="rtl" className="min-h-screen text-foreground">
      <header className="sticky top-0 z-20 border-b border-white/10 backdrop-blur-xl bg-background/40">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-xl btn-glow">
              <Car className="h-6 w-6 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-extrabold tracking-tight">
                <span className="gradient-text">CarADB</span>
              </h1>
              <p className="text-[11px] text-muted-foreground">
                إدارة شاشات السيارات (Android Auto / AAOS) عبر ADB من المتصفح
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {conn ? (
              <>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs text-emerald-300">
                  <PlugZap className="h-3.5 w-3.5" />
                  {conn.device.serial}
                </span>
                <button
                  onClick={doDisconnect}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm hover:bg-white/10"
                >
                  <XCircle className="h-4 w-4" /> قطع
                </button>
              </>
            ) : (
              <button
                onClick={doConnect}
                disabled={!supported || connecting}
                className="btn-glow btn-glow-hover inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                >
                {connecting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Usb className="h-4 w-4" />
                )}
                {connecting ? "جاري الاتصال…" : "توصيل جهاز USB"}
              </button>
            )}
          </div>
        </div>
      </header>

      {!supported && (
        <div className="mx-auto mt-4 flex max-w-6xl items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <XCircle className="h-4 w-4" />
          متصفحك لا يدعم WebUSB. استخدم Chrome أو Edge على كمبيوتر (سطح مكتب).
        </div>
      )}

      <main className="mx-auto grid max-w-6xl gap-4 p-4 lg:grid-cols-3">
        {/* Install */}
        <section className="glass-card rounded-2xl p-5">
          <div className="mb-3 flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/15 text-primary">
              <Upload className="h-4.5 w-4.5" />
            </div>
            <h2 className="font-semibold">تثبيت حزم APK</h2>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            اختر ملف أو أكثر — سيتم رفعها وتشغيل <code className="rounded bg-white/10 px-1">pm install</code>.
          </p>
          <label
            className={`group flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-white/15 bg-white/5 px-4 py-8 text-center text-sm transition hover:border-primary/50 hover:bg-primary/5 ${
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
            <Upload className="mb-2 h-6 w-6 text-primary transition group-hover:scale-110" />
            <span className="font-medium">اسحب ملفات APK أو اضغط للاختيار</span>
            <span className="mt-1 text-xs text-muted-foreground">اختيار متعدد مدعوم</span>
          </label>
          {progress && (
            <div className="mt-3">
              <div className="mb-1 flex justify-between text-xs">
                <span className="truncate">{progress.name}</span>
                <span>{progress.pct}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${progress.pct}%`,
                    background: "var(--gradient-primary)",
                  }}
                  }
                />
              </div>
            </div>
          )}
        </section>

        {/* Packages */}
        <section className="glass-card rounded-2xl p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="grid h-9 w-9 place-items-center rounded-lg bg-accent/15 text-accent">
                <Package className="h-4.5 w-4.5" />
              </div>
              <h2 className="font-semibold">الحزم المثبتة</h2>
            </div>
            <button
              disabled={!conn || busy}
              onClick={() => conn && refreshPackages(conn.adb)}
              className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs hover:bg-white/10 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
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
                className={`rounded-lg px-2.5 py-1 transition ${
                  pkgFilter === f
                    ? "btn-glow text-primary-foreground"
                    : "border border-white/10 bg-white/5 hover:bg-white/10"
                }`}
              >
                {f === "third-party" ? "طرف ثالث" : f === "system" ? "نظام" : "الكل"}
              </button>
            ))}
          </div>
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="ابحث…"
              value={pkgSearch}
              onChange={(e) => setPkgSearch(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 pr-7 text-sm outline-none focus:border-primary/50"
            />
          </div>
          <select
            size={8}
            value={selectedPkg}
            onChange={(e) => setSelectedPkg(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1 font-mono text-xs outline-none focus:border-primary/50"
          >
            {filteredPkgs.map((p) => (
              <option key={p} value={p} className="bg-background">
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
            className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive hover:bg-destructive/20 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            إلغاء تثبيت الحزمة المحددة
          </button>
        </section>

        {/* Permissions */}
        <section className="glass-card rounded-2xl p-5">
          <div className="mb-3 flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-emerald-400/15 text-emerald-300">
              <ShieldCheck className="h-4.5 w-4.5" />
            </div>
            <h2 className="font-semibold">الأذونات</h2>
          </div>
          <label className="mb-1 block text-xs text-muted-foreground">الحزمة المستهدفة</label>
          <input
            value={selectedPkg}
            onChange={(e) => setSelectedPkg(e.target.value)}
            placeholder="com.example.app"
            className="mb-2 w-full rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 font-mono text-xs outline-none focus:border-primary/50"
            />
          <label className="mb-1 block text-xs text-muted-foreground">الإذن</label>
          <select
            value={permission}
            onChange={(e) => setPermission(e.target.value)}
            className="mb-2 w-full rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs outline-none focus:border-primary/50"
            >
            {COMMON_PERMISSIONS.map((p) => (
              <option key={p} value={p} className="bg-background">
                {p.replace("android.permission.", "")}
              </option>
            ))}
          </select>
          <input
            value={permission}
            onChange={(e) => setPermission(e.target.value)}
            className="mb-2 w-full rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 font-mono text-xs outline-none focus:border-primary/50"
            />
          <div className="flex gap-2">
            <button
              onClick={onGrant}
              disabled={!conn || !selectedPkg || busy}
              className="btn-glow btn-glow-hover inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              >
              <ShieldCheck className="h-4 w-4" /> منح
            </button>
            <button
              onClick={onRevoke}
              disabled={!conn || !selectedPkg || busy}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm hover:bg-white/10 disabled:opacity-50"
              >
              <ShieldX className="h-4 w-4" /> سحب
            </button>
          </div>
          <button
            onClick={onGrantAll}
            disabled={!conn || !selectedPkg || busy}
            className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-bold text-white shadow-lg shadow-emerald-500/25 disabled:opacity-50"
            style={{ background: "linear-gradient(135deg, oklch(0.68 0.19 155), oklch(0.72 0.19 195))" }}
            >
            <Zap className="h-4 w-4" />
            منح جميع الأذونات دفعة واحدة
          </button>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            يقرأ الأذونات من manifest التطبيق ويمنحها كلها.
          </p>
        </section>

        {/* App Bundle */}
        <section className="glass-card rounded-2xl p-5 lg:col-span-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="grid h-9 w-9 place-items-center rounded-lg bg-accent/15 text-accent">
                <Layers className="h-4.5 w-4.5" />
              </div>
              <h2 className="font-semibold">حزمة تطبيقات — تثبيت تلقائي</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10">
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
                <Plus className="h-3.5 w-3.5" /> إضافة APK
              </label>
              <button
                onClick={() => setBundle([])}
                disabled={bundle.length === 0 || bundleRunning}
                className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10 disabled:opacity-50"
                >
                <Trash2 className="h-3.5 w-3.5" /> مسح
              </button>
              <button
                onClick={onInstallBundle}
                disabled={!conn || bundle.length === 0 || bundleRunning}
                className="btn-glow btn-glow-hover inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-bold text-primary-foreground disabled:opacity-50"
                >
                {bundleRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                {bundleRunning ? "جاري التثبيت…" : `تثبيت الكل (${bundle.length})`}
              </button>
            </div>
          </div>
          {bundle.length === 0 ? (
            <p className="rounded-xl border border-dashed border-white/10 bg-white/5 px-4 py-6 text-center text-xs text-muted-foreground">
              أضف ملفات APK لتكوين حزمتك، ثم اضغط "تثبيت الكل" لتثبيتها واحداً تلو الآخر تلقائياً.
            </p>
          ) : (
            <ul className="divide-y divide-white/5 rounded-xl border border-white/10 bg-white/5">
      {bundle.map((f, i) => (
                <li key={f.name + i} className="flex items-center justify-between px-3 py-2 text-xs">
                  <span className="flex min-w-0 items-center gap-2 truncate font-mono">
                    <span className="grid h-5 w-5 flex-none place-items-center rounded bg-primary/20 text-[10px] text-primary">
                      {i + 1}
                    </span>
                    <span className="truncate">{f.name}</span>
                  </span>
                  <span className="flex flex-none items-center gap-2">
                    <span className="text-muted-foreground">
                      {(f.size / 1024 / 1024).toFixed(1)}MB
                    </span>
                    <button
                      onClick={() => setBundle((b) => b.filter((_, j) => j !== i))}
                      disabled={bundleRunning}
                      className="inline-flex items-center gap-1 text-destructive hover:underline disabled:opacity-50"
                      >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Custom shell */}
        <section className="glass-card rounded-2xl p-5 lg:col-span-3">
          <div className="mb-3 flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/15 text-primary">
              <Terminal className="h-4.5 w-4.5" />
            </div>
            <h2 className="font-semibold">أمر shell مخصص</h2>
          </div>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm text-primary">$</span>
              <input
                value={customCmd}
                onChange={(e) => setCustomCmd(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && onRunCustom()}
                placeholder="getprop ro.product.model"
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 pl-6 font-mono text-sm outline-none focus:border-primary/50"
                dir="ltr"
              />
            </div>
            <button
              onClick={onRunCustom}
              disabled={!conn || busy}
              className="btn-glow btn-glow-hover inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              >
              <Play className="h-4 w-4" /> تنفيذ
            </button>
          </div>
        </section>

        {/* Log */}
        <section className="glass-card rounded-2xl p-5 lg:col-span-3">
          <div className="mb-3 flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-accent/15 text-accent">
              <ScrollText className="h-4.5 w-4.5" />
            </div>
            <h2 className="font-semibold">السجل</h2>
          </div>
          <div
            ref={logRef}
            dir="ltr"
            className="h-72 overflow-auto rounded-xl border border-white/10 bg-black/40 p-3 font-mono text-xs"
            >
            {logs.length === 0 ? (
              <div className="text-muted-foreground">لا توجد سجلات بعد.</div>
            ) : (
              logs.map((l, i) => (
                <div
                  key={i}
                  className={`flex items-start gap-1.5 ${
                    l.kind === "err"
                      ? "text-destructive"
                      : l.kind === "ok"
                        
                        ? "text-emerald-300"
                        : "text-foreground/80"
                  }`}
                >
                  {l.kind === "err" ? (
                    <XCircle className="mt-0.5 h-3 w-3 flex-none" />
                  ) : l.kind === "ok" ? (
                    <CheckCircle2 className="mt-0.5 h-3 w-3 flex-none" />
                  ) : (
                    <Info className="mt-0.5 h-3 w-3 flex-none opacity-60" />
                  )}
                  <span className="text-muted-foreground">[{l.time}]</span>
                  <span className="whitespace-pre-wrap">{l.text}</span>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="glass-card rounded-2xl p-5 lg:col-span-3">
          <div className="mb-3 flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/15 text-primary">
              <Plug className="h-4.5 w-4.5" />
            </div>
            <h2 className="font-semibold">تعليمات مهمة</h2>
          </div>
          <ol className="list-inside list-decimal space-y-1.5 text-sm text-muted-foreground marker:text-primary">
            <li>يجب استخدام Chrome أو Edge على كمبيوتر (WebUSB لا يعمل على iOS).</li>
            <li>
              على شاشة السيارة/الجهاز: فعّل <b className="text-foreground">Developer Options</b> ثم <b className="text-foreground">USB debugging</b>.
              لبعض شاشات AAOS: فعّل <b className="text-foreground">ADB over USB</b> من قائمة المطور.
            </li>
            <li>وصّل كابل USB بين الكمبيوتر وشاشة السيارة، اضغط "توصيل جهاز USB" واختره.</li>
            <li>عند أول اتصال ستظهر رسالة "Allow USB debugging?" على الشاشة — اقبلها.</li>
            <li>
              على ويندوز قد تحتاج تعريف <i className="text-foreground">Google USB Driver</i> أو WinUSB عبر Zadig ليظهر الجهاز في المتصفح.
            </li>
          </ol>
        </section>
      </main>
    </div>
  );
}
