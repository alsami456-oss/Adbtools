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
} from "../lib/adb-client";

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

  const onGrantStoragePermission = async () => {
    if (!conn || !selectedPkg) {
      log("الرجاء اختيار حزمة أولاً لتطبيق الأمر عليها.", "info");
      return;
    }
    setBusy(true);
    try {
      log(`جاري منح صلاحيات الذاكرة للتطبيق: ${selectedPkg}...`);
      await runShell(conn.adb, `pm grant ${selectedPkg} android.permission.WRITE_EXTERNAL_STORAGE`);
      await runShell(conn.adb, `pm grant ${selectedPkg} android.permission.READ_EXTERNAL_STORAGE`);
      log(`تم منح صلاحيات القراءة والكتابة للذاكرة بنجاح!`, "ok");
    } catch (e) {
      log(`فشل تطبيق الأمر: ${(e as Error).message}`, "err");
    } finally {
      setBusy(false);
    }
  };

  const onForceStopLauncher = async () => {
    if (!conn) return;
    setBusy(true);
    try {
      log(`جاري إعادة تشغيل واجهة السيارة...`);
      await runShell(conn.adb, `am force-stop ${selectedPkg || "com.carlauncher.pro"}`);
      log(`تم إرسال أمر إيقاف وتشغيل الواجهة بنجاح.`, "ok");
    } catch (e) {
      log(`فشل تطبيق الأمر: ${(e as Error).message}`, "err");
    } finally {
      setBusy(false);
    }
  };

  const filteredPkgs = packages.filter((p) => p.includes(pkgSearch.toLowerCase()));

  return (
    <div dir="rtl" className="min-h-screen bg-[#060b19] text-slate-100 font-sans antialiased pb-12" style={{ direction: 'rtl' }}>

      {/* الهيدر العلوي */}
      <header className="border-b border-slate-800 bg-[#070d1e]/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 flex-col sm:flex-row gap-4">
          <div className="text-right">
            <h1 className="text-2xl font-bold text-[#10b981]">منصة برمجة شاشات السيارات</h1>
            <p className="text-xs text-slate-400 mt-1">
              متوافق بالكامل مع شاشات السيارات الذكية
            </p>
          </div>
          <div className="flex items-center gap-3">
            {conn ? (
              <>
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  متصل: {conn.device.serial}
                </span>
                <button
                  onClick={doDisconnect}
                  className="rounded-xl border border-rose-500/30 text-rose-400 px-4 py-2 text-sm font-medium hover:bg-rose-500/10 transition-colors"
                >
                  قطع الاتصال
                </button>
              </>
            ) : (
              <button
                onClick={doConnect}
                disabled={!supported || connecting}
                className="flex items-center gap-2 rounded-xl bg-[#2563eb] hover:bg-blue-600 transition-colors px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-900/30 disabled:opacity-50"
              >
                🔌 {connecting ? "جاري الاتصال…" : "توصيل جهاز USB"}
              </button>
            )}

            <a 
              href="https://t.me/SAM_T2"
              target="_blank" 
              rel="noopener noreferrer"
              className="flex items-center gap-2 bg-[#10b981] hover:bg-[#059669] text-slate-950 transition-colors px-4 py-2.5 rounded-xl text-sm font-bold shadow-lg shadow-[#10b981]/20"
            >
              💬 الدعم الفني تيليجرام
            </a>
          </div>
        </div>
      </header>

      {!supported && (
        <div className="mx-auto mt-4 max-w-6xl rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400 text-center">
          ⚠️ متصفحك لا يدعم WebUSB. استخدم Chrome أو Edge على كمبيوتر (سطح مكتب).
        </div>
      )}

      <main className="mx-auto grid max-w-6xl gap-6 p-4 lg:grid-cols-3 mt-6">

        {/* قسم تثبيت حزم APK */}
        <section className="rounded-2xl border border-slate-800 bg-[#0b1329] p-5 shadow-xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-[#10b981]/5 rounded-full blur-2xl" />
          <div className="flex items-center gap-2 mb-2 text-[#10b981]">
            <span className="text-xl">📥</span>
            <h2 className="font-bold text-lg">تثبيت حزم APK المباشر</h2>
          </div>
          <p className="mb-4 text-xs text-slate-400 leading-relaxed">
            يمكن اختيار حزمة كاملة (عدة APK). سيتم رفعها للجهاز وتشغيل التثبيت التلقائي في شاشتك.
          </p>
          <label
            className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-800 hover:border-[#10b981]/50 bg-[#070d1e] px-4 py-10 text-center text-sm transition-all hover:bg-[#070d1e]/80 ${
              !conn ? "pointer-events-none opacity-40" : ""
            }`}
          >
            <input
              type="file"
              accept=".apk,application/vnd.android.package-archive"
              multiple
              className="hidden"
              onChange={(e) => onInstall(e.target.files)}
            />
            <span className="font-bold text-slate-300">اسحب ملفات APK هنا أو اضغط للاختيار</span>
            <span className="mt-1.5 text-xs text-slate-500">يدعم اختيار متعدد لتوفير وقتك</span>
          </label>
          {progress && (
            <div className="mt-4 bg-[#070d1e] p-3 rounded-xl border border-slate-800">
              <div className="mb-2 flex justify-between text-xs">
                <span className="truncate font-mono text-slate-300">{progress.name}</span>
                <span className="font-bold text-[#10b981]">{progress.pct}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full bg-[#10b981] transition-all"
                  style={{ width: `${progress.pct}%` }}
                />
              </div>
            </div>
          )}
        </section>

        {/* قسم الحزم المثبتة في السيارة */}
        <section className="rounded-2xl border border-slate-800 bg-[#0b1329] p-5 shadow-xl">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-bold text-lg text-slate-200">📱 الحزم المثبتة بالسيارة</h2>
            <button
              disabled={!conn || busy}
              onClick={() => conn && refreshPackages(conn.adb)}
              className="rounded-lg border border-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-[#070d1e] hover:border-slate-700 transition-all disabled:opacity-50"
            >
              🔄 تحديث القائمة
            </button>
          </div>
          <div className="mb-3 flex gap-1.5 text-xs">
            {(["third-party", "system", "all"] as const).map((f) => (
              <button
                key={f}
                onClick={() => {
                  setPkgFilter(f);
                  if (conn) refreshPackages(conn.adb, f);
                }}
                className={`flex-1 rounded-lg py-1.5 text-center font-semibold transition-all ${
                  pkgFilter === f
                    ? "bg-[#10b981] text-slate-950"
                    : "bg-[#070d1e] text-slate-400 border border-slate-800 hover:border-slate-700"
                }`}
              >
                {f === "third-party" ? "طرف ثالث" : f === "system" ? "النظام" : "الكل"}
              </button>
            ))}
          </div>
          <input
            type="text"
            placeholder="ابحث عن تطبيق معين..."
            value={pkgSearch}
            onChange={(e) => setPkgSearch(e.target.value)}
            className="mb-3 w-full rounded-xl border border-slate-800 bg-[#070d1e] px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-[#10b981]/50"
          />
          <select
            size={8}
            value={selectedPkg}
            onChange={(e) => setSelectedPkg(e.target.value)}
            className="w-full rounded-xl border border-slate-800 bg-[#070d1e] p-2 font-mono text-xs text-slate-300 focus:outline-none focus:border-[#10b981]/50"
          >
            {filteredPkgs.map((p) => (
              <option key={p} value={p} className="py-1">
                {p}
              </option>
            ))}
          </select>
          <div className="mt-2.5 flex justify-between items-center text-xs text-slate-500">
            <span>المعروض: {filteredPkgs.length} من أصل {packages.length}</span>
          </div>
          <button
            onClick={onUninstall}
            disabled={!conn || !selectedPkg || busy}
            className="mt-3 w-full rounded-xl border border-rose-900/30 bg-rose-950/20 px-3 py-2.5 text-xs font-bold text-rose-400 hover:bg-rose-950/40 transition-all disabled:opacity-50"
          >
            ❌ إلغاء تثبيت الحزمة المحددة نهائياً
          </button>
        </section>

        {/* قسم إدارة أذونات النظام والأكواد */}
        <section className="rounded-2xl border border-slate-800 bg-[#0b1329] p-5 shadow-xl">
          <div className="flex items-center gap-2 mb-3 text-yellow-500">
            <span className="text-xl">⚙️</span>
            <h2 className="font-bold text-lg">الأذونات والصلاحيات</h2>
          </div>
          <label className="mb-1.5 block text-xs text-slate-400">الحزمة المستهدفة</label>
          <input
            value={selectedPkg}
            onChange={(e) => setSelectedPkg(e.target.value)}
            placeholder="com.example.app"
            className="mb-3 w-full rounded-xl border border-slate-800 bg-[#070d1e] px-3 py-2 font-mono text-xs text-slate-200"
          />
          <label className="mb-1.5 block text-xs text-slate-400 font-medium">نوع الإذن المخصص</label>
          <select
            value={permission}
            onChange={(e) => setPermission(e.target.value)}
            className="mb-3 w-full rounded-xl border border-slate-800 bg-[#070d1e] p-2 text-xs text-slate-200"
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
            className="mb-4 w-full rounded-xl border border-slate-800 bg-[#070d1e] px-3 py-2 font-mono text-xs text-slate-300"
          />
          <div className="flex gap-2">
            <button
              onClick={onGrant}
              disabled={!conn || !selectedPkg || busy}
              className="flex-1 rounded-xl bg-[#2563eb] hover:bg-blue-600 px-4 py-2.5 text-xs font-bold text-white transition-colors disabled:opacity-50"
            >
              منح الإذن المخصص
            </button>
            <button
              onClick={onRevoke}
              disabled={!conn || !selectedPkg || busy}
              className="flex-1 rounded-xl border border-slate-800 hover:border-slate-700 bg-[#070d1e] px-4 py-2.5 text-xs font-bold text-slate-300 transition-colors disabled:opacity-50"
            >
              سحب الإذن
            </button>
          </div>
          <button
            onClick={onGrantAll}
            disabled={!conn || !selectedPkg || busy}
            className="mt-3 w-full rounded-xl bg-[#10b981] hover:bg-[#059669] px-4 py-3 text-xs font-bold text-slate-950 transition-colors disabled:opacity-50 shadow-lg shadow-[#10b981]/10"
          >
            ⚡ منح جميع الأذونات دفعة واحدة
          </button>
          <p className="mt-2 text-[10px] text-slate-500 text-center">
            يقرأ الأذونات المطلوبة من manifest التطبيق ويمنحها تلقائياً للشاشة.
          </p>
        </section>
               <section className="rounded-2xl border border-slate-800 bg-[#0b1329] p-5 shadow-xl lg:col-span-3">
          <div className="mb-4 flex items-center justify-between flex-col sm:flex-row gap-3">
            <div>
              <h2 className="font-bold text-lg text-slate-200">📦 حزمة تطبيقاتك الخاصة</h2>
              <p className="text-xs text-slate-400 mt-1">تثبيت سلس وتلقائي لعدة تطبيقات واحداً تلو الآخر</p>
            </div>
            <div className="flex gap-2 w-full sm:w-auto">
              <label className="flex-1 sm:flex-initial text-center cursor-pointer rounded-xl border border-slate-800 hover:border-slate-700 bg-[#070d1e] px-4 py-2 text-xs font-bold text-slate-300 transition-colors">
                ➕ إضافة ملفات للـ Bundle
                <input
                  type="file"
                  accept=".apk"
                  multiple
                  className="hidden"
                  onChange={(e) => onAddBundleFiles(e.target.files)}
                />
              </label>
              <button
                onClick={onInstallBundle}
                disabled={!conn || bundle.length === 0 || bundleRunning}
                className="flex-1 sm:flex-initial rounded-xl bg-[#10b981] hover:bg-[#059669] text-slate-950 px-5 py-2 text-xs font-bold disabled:opacity-40 transition-colors"
              >
                {bundleRunning ? "جاري التثبيت تلقائياً..." : "🚀 بدء تثبيت الحزمة"}
              </button>
            </div>
          </div>

          {bundle.length > 0 && (
            <div className="max-h-40 overflow-y-auto space-y-1 rounded-xl bg-[#070d1e] p-3 border border-slate-800 font-mono text-xs">
              {bundle.map((f, idx) => (
                <div key={idx} className="flex justify-between text-slate-400 py-1 border-b border-slate-900 last:border-0">
                  <span className="truncate">{f.name}</span>
                  <span className="text-slate-600">{(f.size / 1024 / 1024).toFixed(2)} MB</span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* أدوات التحكم السريع للشاشات */}
        <section className="rounded-2xl border border-slate-800 bg-[#0b1329] p-5 shadow-xl lg:col-span-3">
          <h2 className="font-bold text-lg text-slate-200 mb-3">🛠️ اختصارات ذكية للسيارة</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              onClick={onGrantStoragePermission}
              disabled={!conn}
              className="rounded-xl border border-slate-800 bg-[#070d1e] hover:border-[#2563eb]/50 p-4 text-right transition-all disabled:opacity-40"
            >
              <h4 className="text-sm font-bold text-blue-400">🔓 منح صلاحيات الذاكرة فورا</h4>
              <p className="text-xs text-slate-400 mt-1">تخطي قيود حظر قراءة الملفات والخرائط للتطبيق المحدد.</p>
            </button>
            <button
              onClick={onForceStopLauncher}
              disabled={!conn}
              className="rounded-xl border border-slate-800 bg-[#070d1e] hover:border-rose-500/50 p-4 text-right transition-all disabled:opacity-40"
            >
             <h4 className="text-sm font-bold text-rose-400">🔄 إنعاش الواجهة (Force Stop Launcher)</h4>
              <p className="text-xs text-slate-400 mt-1">إيقاف قسري للواجهة لإعادة تطبيق الثيمات أو الأيقونات الجديدة.</p>
            </button>
          </div>
        </section>

        {/* موجه الأوامر المخصص للـ Shell */}
        <section className="rounded-2xl border border-slate-800 bg-[#0b1329] p-5 shadow-xl lg:col-span-3">
          <h2 className="font-bold text-lg text-slate-200 mb-2">💻 موجه أوامر ADB Shell مخصص</h2>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="أدخل أمر shell مخصص هنا... (مثال: pm list packages)"
              value={customCmd}
              onChange={(e) => setCustomCmd(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onRunCustom()}
              className="flex-1 rounded-xl border border-slate-800 bg-[#070d1e] px-4 py-2.5 text-sm font-mono text-slate-200 focus:outline-none focus:border-[#10b981]/50"
            />
            <button
              onClick={onRunCustom}
              disabled={!conn || !customCmd.trim() || busy}
              className="rounded-xl bg-blue-600 hover:bg-blue-700 px-6 py-2.5 text-sm font-bold text-white transition-colors disabled:opacity-40"
            >
              تشغيل الأمر
            </button>
          </div>
        </section>

      </main>

      {/* قسم السجلات والـ Logs */}
      <section className="mx-auto max-w-6xl px-4 mt-6">
        <div className="rounded-2xl border border-slate-800 bg-[#070d1e] p-5 shadow-inner">
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-bold text-sm text-slate-300">📟 وحدة التحكم والـ Logs للمطور</h3>
            <button 
              onClick={() => setLogs([])}
              className="text-[10px] text-slate-500 hover:text-slate-300"
            >
              مسح السجل
            </button>
          </div>
          <div 
            ref={logRef}
            className="h-48 overflow-y-auto rounded-xl bg-slate-950/90 p-4 font-mono text-xs space-y-1.5"
          >
            {logs.length === 0 ? (
              <span className="text-slate-600">بانتظار توصيل شاشة السيارة عبر الـ USB لبدء رصد الأوامر...</span>
            ) : (
              logs.map((l, i) => (
                <div key={i} className="flex gap-2">
                  <span className="text-slate-600">[{l.time}]</span>
                  <span className={l.kind === "err" ? "text-rose-400" : l.kind === "ok" ? "text-emerald-400" : "text-slate-300"}>
                    {l.text}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

    </div>
  );
}