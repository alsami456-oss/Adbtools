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
      { title: "CarADB — إدارة شاشات السيارات عبر ADB" },
      {
        name: "description",
        content:
          "أداة ويب متطورة لتوصيل شاشات السيارات (Android Auto / AAOS) عبر ADB، تثبيت حزم APK، ومنح الأذونات مباشرة من المتصفح بتصميم عصري.",
      },
      { property: "og:title", content: "CarADB — إدارة شاشات السيارات عبر ADB" },
      {
        property: "og:description",
        content: "توصيل متطور، تثبيت APK، ومنح الأذونات من المتصفح باستخدام تقنيات WebUSB الحديثة.",
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
        log("لم يتم اختيار جهاز. 🔌", "info");
        return;
      }
      log(`جاري الاتصال بـ ${device.serial}… وافق على طلب ADB على الشاشة. 🖥️`);
      const c = await connect(device);
      setConn(c);
      log(`متصل بنجاح بـ ${c.device.serial} ✅`, "ok");
      await refreshPackages(c.adb, pkgFilter);
    } catch (e) {
      log(`فشل الاتصال: ${(e as Error).message} ❌`, "err");
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
    log("تم قطع الاتصال بالجهاز. 🚫", "info");
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
      log(`تم جلب ${list.length} حزمة بنجاح (${filter === "third-party" ? "طرف ثالث" : filter === "system" ? "نظام" : "الكل"}). 📦`, "ok");
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
          log(`تخطي ${file.name}: ليس ملف APK مدعوم. ⚠️`, "info");
          continue;
        }
        setProgress({ name: file.name, pct: 0 });
        log(`جاري رفع ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB) إلى الشاشة… 💾`);
        const result = await installApk(conn.adb, file, (loaded, total) =>
          setProgress({ name: file.name, pct: Math.round((loaded / total) * 100) }),
        );
        log(`نتيجة تثبيت ${file.name}: ${result || "Success ✅"}`, result.includes("Success") || !result ? "ok" : "err");
      }
      setProgress(null);
      await refreshPackages(conn.adb);
    } catch (e) {
      log(`حدث خطأ أثناء التثبيت: ${(e as Error).message}`, "err");
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
      log(`منح إذن [${permission.replace("android.permission.", "")}] ← الحزمة [${selectedPkg}]: ${r || "تم بنجاح ✓"}`, "ok");
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
      log(`سحب إذن [${permission.replace("android.permission.", "")}] ← الحزمة [${selectedPkg}]: ${r || "تم بنجاح ✓"}`, "ok");
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
      log(`جاري فحص وقراءة الأذونات المطلوبة لـ ${selectedPkg}… 🔍`);
      const res = await grantAllPermissions(conn.adb, selectedPkg, (p, ok, msg) => {
        log(`  ${ok ? "✓ تم منح" : "✗ تعذر"} ${p.replace("android.permission.", "")}${ok ? "" : ` — السبب: ${msg}`}`, ok ? "ok" : "info");
      });
      log(
        `اكتملت العملية: تم منح ${res.granted}/${res.total} إذن لـ ${selectedPkg} (فشل ${res.failed}).`,
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
        log(`جاري معالجة وتثبيت ${file.name} من الحزمة التلقائية… 🚀`);
        try {
          const result = await installApk(conn.adb, file, (loaded, total) =>
            setProgress({
              name: `(${i + 1}/${bundle.length}) ${file.name}`,
              pct: Math.round((loaded / total) * 100),
            }),
          );
          const success = result.includes("Success") || !result;
          log(`${file.name}: ${result || "Success ✅"}`, success ? "ok" : "err");
          success ? ok++ : fail++;
        } catch (e) {
          fail++;
          log(`${file.name}: ${(e as Error).message}`, "err");
        }
      }
      log(`🏁 اكتمل تثبيت الحزمة التلقائية: ${ok} نجاح 🎉، ${fail} فشل من إجمالي ${bundle.length} تطبيق.`, fail === 0 ? "ok" : "info");
      await refreshPackages(conn.adb);
    } finally {
      setProgress(null);
      setBundleRunning(false);
      setBusy(false);
    }
  };

  const onUninstall = async () => {
    if (!conn || !selectedPkg) return;
    if (!confirm(`🚨 تنبيه: هل أنت متأكد تماماً من حذف التطبيق ${selectedPkg} من الشاشة؟`)) return;
    setBusy(true);
    try {
      const r = await uninstallPackage(conn.adb, selectedPkg);
      log(`إلغاء تثبيت الحزمة ${selectedPkg}: ${r || "تم الحذف بنجاح ✓"}`, "ok");
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
      log(r || "(تم التنفيذ - لا يوجد مخرجات نصية)", "ok");
    } catch (e) {
      log((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  const filteredPkgs = packages.filter((p) => p.includes(pkgSearch.toLowerCase()));
    return (
    <div dir="rtl" className="min-h-screen bg-[#070A13] text-[#E2E8F0] font-sans antialiased selection:bg-cyan-500/30 selection:text-cyan-200">
      
      {/* HEADER SECTION */}
      <header className="border-b border-cyan-500/10 bg-[#0B0F19]/80 backdrop-blur-md sticky top-0 z-50 shadow-[0_4px_20px_rgba(0,0,0,0.4)]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-xl shadow-[0_0_15px_rgba(6,182,212,0.4)]">
              <span className="text-xl">🚘</span>
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-teal-300 to-blue-500">
                CarADB <span className="text-xs font-normal text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded-full border border-cyan-500/20 mr-1">Pro v2.0</span>
              </h1>
              <p className="text-[11px] text-gray-400 mt-0.5">
                المنصة الذكية المتكاملة لإدارة شاشات السيارات عبر ميزة WebUSB المتطورة ⚡
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {conn ? (
              <div className="flex items-center gap-2 bg-[#111827]/90 p-1.5 rounded-xl border border-green-500/20 shadow-inner">
                <span className="flex h-2.5 w-2.5 rounded-full bg-green-500 animate-pulse m-1" />
                <span className="text-xs font-mono font-medium text-green-400 bg-green-500/5 px-2 py-1 rounded-md">
                  متصل بنجاح: {conn.device.serial}
                </span>
                <button
                  onClick={doDisconnect}
                  className="rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-1.5 text-xs font-bold text-red-400 hover:bg-red-500 hover:text-white transition-all duration-200"
                >
                  قطع الاتصال 🔌
                </button>
              </div>
            ) : (
              <button
                onClick={doConnect}
                disabled={!supported || connecting}
                className="relative overflow-hidden rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-5 py-2.5 text-xs font-black text-white transition-all duration-300 hover:from-cyan-400 hover:to-blue-500 disabled:opacity-40 hover:shadow-[0_0_20px_rgba(6,182,212,0.5)] active:scale-95 flex items-center gap-2"
              >
                {connecting ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    جاري البحث والاتصال…
                  </>
                ) : (
                  <>
                    <span>⚡</span> توصيل جهاز USB الشاشة
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </header>

      {/* WEBUSB COMPATIBILITY WARNING */}
      {!supported && (
        <div className="mx-auto mt-4 max-w-6xl rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3.5 text-sm text-red-400 shadow-[0_0_15px_rgba(239,68,68,0.1)] flex items-center gap-2">
          <span>⚠️</span>
          <p>
            <b>عذراً، متصفحك الحالي لا يدعم بروتوكول WebUSB المتطور!</b> يرجى فتح المنصة باستخدام متصفحات <b>Google Chrome</b> أو <b>Microsoft Edge</b> على جهاز كمبيوتر لضمان التوصيل.
          </p>
        </div>
      )}

      {/* MAIN LAYOUT */}
      <main className="mx-auto grid max-w-6xl gap-5 p-4 lg:grid-cols-3">
        
        {/* SECTION 1: APK INSTALLATION */}
        <section className="rounded-2xl border border-[#1E293B]/60 bg-[#111827]/60 backdrop-blur-xl p-5 shadow-lg relative overflow-hidden group hover:border-cyan-500/30 transition-all duration-300">
          <div className="absolute top-0 right-0 h-[2px] w-0 bg-cyan-500 group-hover:w-full transition-all duration-500" />
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xl">📦</span>
            <h2 className="font-extrabold text-gray-200 tracking-wide text-sm">تثبيت حزم تطبيقات APK</h2>
          </div>
          <p className="mb-4 text-xs text-gray-400 leading-relaxed">
            يمكنك سحب وإفلات حزمة كاملة أو اختيار ملفات APK متعددة ليقوم النظام برفعها وتثبيتها بشكل آلي وآمن عبر سطر الأوامر <code>pm install</code>.
          </p>
          <label
            className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-[#1E293B] bg-[#0B0F19]/40 px-4 py-9 text-center transition-all duration-300 hover:border-cyan-500/40 hover:bg-cyan-500/5 group/drop ${
              !conn ? "pointer-events-none opacity-40 grayscale" : ""
            }`}
          >
            <input
              type="file"
              accept=".apk,application/vnd.android.package-archive"
              multiple
              className="hidden"
              onChange={(e) => onInstall(e.target.files)}
            />
            <div className="mb-3 p-3 bg-[#1F2937]/50 rounded-full border border-gray-700/50 group-hover/drop:scale-110 group-hover/drop:border-cyan-400/40 transition-all duration-300">
              <span className="text-2xl text-cyan-400">📥</span>
            </div>
            <span className="text-xs font-bold text-gray-300 group-hover/drop:text-cyan-400">اسحب ملفات APK هنا أو اضغط للاختيار</span>
            <span className="mt-1 text-[10px] text-gray-500">يدعم السحب والإفلات للملفات المتعددة</span>
          </label>
          
          {progress && (
            <div className="mt-4 p-3 rounded-xl bg-[#0B0F19]/80 border border-cyan-500/20">
              <div className="mb-1.5 flex justify-between text-[11px] font-mono">
                <span className="truncate text-cyan-400 max-w-[80%]">⏳ {progress.name}</span>
                <span className="font-bold text-teal-400">{progress.pct}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-gray-800 p-[1px]">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-teal-400 transition-all duration-300 shadow-[0_0_10px_rgba(6,182,212,0.5)]"
                  style={{ width: `${progress.pct}%` }}
                />
              </div>
            </div>
          )}
        </section>

        {/* SECTION 2: INSTALLED PACKAGES MANAGER */}
        <section className="rounded-2xl border border-[#1E293B]/60 bg-[#111827]/60 backdrop-blur-xl p-5 shadow-lg relative overflow-hidden group hover:border-blue-500/30 transition-all duration-300">
          <div className="absolute top-0 right-0 h-[2px] w-0 bg-blue-500 group-hover:w-full transition-all duration-500" />
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xl">🛠️</span>
              <h2 className="font-extrabold text-gray-200 tracking-wide text-sm">الحزم والتطبيقات المثبتة</h2>
            </div>
            <button
              disabled={!conn || busy}
              onClick={() => conn && refreshPackages(conn.adb)}
              className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 px-2.5 py-1 text-xs font-bold text-cyan-400 hover:bg-cyan-500 hover:text-white disabled:opacity-30 transition-all duration-200"
            >
              🔄 تحديث
            </button>
          </div>
          
          <div className="mb-3 flex gap-1 p-0.5 rounded-lg bg-[#0B0F19]/60 border border-gray-800">
            {(["third-party", "system", "all"] as const).map((f) => (
              <button
                key={f}
                onClick={() => {
                  setPkgFilter(f);
                  if (conn) refreshPackages(conn.adb, f);
                }}
                className={`flex-1 text-center rounded-md py-1 text-[11px] font-bold transition-all duration-200 ${
                  pkgFilter === f
                    ? "bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-[0_2px_8px_rgba(6,182,212,0.3)]"
                    : "text-gray-400 hover:text-gray-200 hover:bg-gray-800/50"
                }`}
              >
                {f === "third-party" ? "🕺 طرف ثالث" : f === "system" ? "⚙️ نظام" : "📁 الكل"}
              </button>
            ))}
          </div>
          
          <div className="relative mb-2">
            <input
              type="text"
              placeholder="ابحث عن تطبيق معين بالفهرس…"
              value={pkgSearch}
              onChange={(e) => setPkgSearch(e.target.value)}
              className="w-full rounded-xl border border-[#1E293B] bg-[#0B0F19]/60 px-3 py-2 text-xs focus:outline-none focus:border-cyan-500/50 text-gray-200"
            />
            <span className="absolute left-3 top-2.5 text-xs opacity-40">🔍</span>
          </div>
          
          <select
            size={6}
            value={selectedPkg}
            onChange={(e) => setSelectedPkg(e.target.value)}
            className="w-full rounded-xl border border-[#1E293B] bg-[#0B0F19]/80 px-2 py-1 font-mono text-[11px] text-gray-300 focus:outline-none focus:border-blue-500/50 h-32 divide-y divide-gray-800/30"
          >
            {filteredPkgs.map((p) => (
              <option key={p} value={p} className="py-1 px-1 rounded hover:bg-blue-500/10 cursor-pointer text-left" dir="ltr">
                {p}
              </option>
            ))}
          </select>
          
          <div className="mt-2.5 flex items-center justify-between text-[11px] text-gray-400 bg-[#0B0F19]/40 p-1.5 rounded-lg border border-gray-800/50">
            <span>📊 حزم الفلتر الحالية:</span>
            <span className="font-mono font-bold text-cyan-400">{filteredPkgs.length} / {packages.length}</span>
          </div>
          
          <button
            onClick={onUninstall}
            disabled={!conn || !selectedPkg || busy}
            className="mt-3 w-full rounded-xl bg-red-500/10 border border-red-500/20 py-2.5 text-xs font-black text-red-400 hover:bg-red-600 hover:text-white disabled:opacity-30 transition-all duration-200 shadow-md"
          >
            🗑️ إلغاء تثبيت الحزمة المحددة نهائياً
          </button>
        </section>

        {/* SECTION 3: PERMISSIONS GRANTER */}
        <section className="rounded-2xl border border-[#1E293B]/60 bg-[#111827]/60 backdrop-blur-xl p-5 shadow-lg relative overflow-hidden group hover:border-teal-500/30 transition-all duration-300">
          <div className="absolute top-0 right-0 h-[2px] w-0 bg-teal-500 group-hover:w-full transition-all duration-500" />
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xl">🛡️</span>
            <h2 className="font-extrabold text-gray-200 tracking-wide text-sm">أذونات النظام والتطبيقات</h2>
          </div>
          
          <label className="mb-1 block text-[10px] font-bold text-gray-400 uppercase tracking-wider">الحزمة المستهدفة</label>
          <input
            value={selectedPkg}
            onChange={(e) => setSelectedPkg(e.target.value)}
            placeholder="com.example.app"
            className="mb-2.5 w-full rounded-xl border border-[#1E293B] bg-[#0B0F19]/60 px-3 py-1.5 font-mono text-xs text-cyan-400 text-left"
            dir="ltr"
          />
          
          <label className="mb-1 block text-[10px] font-bold text-gray-400 uppercase tracking-wider">اختيار الإذن البرمجي</label>
          <select
            value={permission}
            onChange={(e) => setPermission(e.target.value)}
            className="mb-2 w-full rounded-xl border border-[#1E293B] bg-[#0B0F19]/60 px-2 py-2 text-xs text-gray-300 focus:outline-none"
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
            className="mb-3 w-full rounded-xl border border-[#1E293B] bg-[#0B0F19]/80 px-3 py-1.5 font-mono text-[11px] text-gray-400 text-left"
            dir="ltr"
          />
          
          <div className="flex gap-2">
            <button
              onClick={onGrant}
              disabled={!conn || !selectedPkg || busy}
              className="flex-1 rounded-xl bg-gradient-to-r from-teal-500 to-emerald-600 px-4 py-2 text-xs font-black text-white hover:from-teal-400 hover:to-emerald-500 disabled:opacity-30 transition-all duration-200 shadow-sm"
            >
              ✓ منح الإذن
            </button>
            <button
              onClick={onRevoke}
              disabled={!conn || !selectedPkg || busy}
              className="flex-1 rounded-xl border border-[#1E293B] bg-[#1F2937]/40 px-4 py-2 text-xs font-bold text-gray-300 hover:bg-gray-800 disabled:opacity-30 transition-all duration-200"
            >
              ✕ سحب الإذن
            </button>
          </div>
          
          <button
            onClick={onGrantAll}
            disabled={!conn || !selectedPkg || busy}
            className="mt-3 w-full rounded-xl bg-gradient-to-r from-green-500 via-teal-500 to-emerald-600 py-2.5 text-xs font-black text-white hover:opacity-90 disabled:opacity-30 transition-all duration-200 shadow-[0_0_15px_rgba(16,185,129,0.2)] flex items-center justify-center gap-1.5"
          >
            ⚡ منح جميع الأذونات دفعة واحدة
          </button>
          <p className="mt-1.5 text-[10px] text-center text-gray-500 leading-normal">
            يقوم بفحص الـ Manifest للتطبيق برمجياً ومنح كل الأذونات المطلوبة في ثوانٍ.
          </p>
        </section>

        {/* SECTION 4: AUTOMATIC APP BUNDLE BATCH */}
        <section className="rounded-2xl border border-[#1E293B]/60 bg-[#111827]/60 backdrop-blur-xl p-5 shadow-lg lg:col-span-3 relative overflow-hidden group hover:border-purple-500/20 transition-all duration-300">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xl">🚀</span>
              <div>
                <h2 className="font-extrabold text-gray-200 text-sm">حزمة تطبيقات متكاملة — التثبيت المتسلسل التلقائي</h2>
                <p className="text-[10px] text-gray-500 mt-0.5">قم بجدولة قائمة تطبيقات ليقوم النظام بتثبيتها واحداً تلو الآخر تلقائياً وبدون تدخل منك.</p>
              </div>
            </div>
            
            <div className="flex gap-1.5">
              <label className="cursor-pointer rounded-xl border border-[#1E293B] bg-[#0B0F19]/60 px-3.5 py-2 text-xs font-bold text-gray-300 hover:bg-gray-800 transition-all flex items-center gap-1">
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
                ➕ إضافة APK للحزمة
              </label>
              <button
                onClick={() => setBundle([])}
                disabled={bundle.length === 0 || bundleRunning}
                className="rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs font-bold text-red-400 hover:bg-red-600 hover:text-white disabled:opacity-30 transition-all"
              >
                🧹 مسح
              </button>
              <button
                onClick={onInstallBundle}
                disabled={!conn || bundle.length === 0 || bundleRunning}
                className="rounded-xl bg-gradient-to-r from-purple-500 to-indigo-600 px-4 py-2 text-xs font-black text-white hover:from-purple-400 hover:to-indigo-500 disabled:opacity-30 transition-all shadow-[0_0_15px_rgba(147,51,234,0.3)]"
              >
                {bundleRunning ? "⏳ جاري التثبيت المتسلسل…" : `▶ تشغيل وتثبيت الكل (${bundle.length})`}
              </button>
            </div>
          </div>
          
          {bundle.length === 0 ? (
            <div className="text-center py-6 border border-dashed border-gray-800 rounded-xl bg-[#0B0F19]/20 text-xs text-gray-500">
               لا توجد ملفات مجدولة في الحزمة حالياً. أضف ملفات بالأعلى للبدء.
            </div>
          ) : (
            <ul className="divide-y divide-gray-800/60 rounded-xl border border-gray-800 bg-[#0B0F19]/50 overflow-hidden">
              {bundle.map((f, i) => (
                <li key={f.name + i} className="flex items-center justify-between px-4 py-2.5 text-xs hover:bg-gray-800/20 transition-colors">
                  <span className="truncate font-mono text-gray-300 flex items-center gap-1.5" dir="ltr">
                    <span className="text-purple-400 font-bold">[{i + 1}]</span> {f.name}
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="text-[11px] font-mono text-gray-500 bg-gray-900 px-2 py-0.5 rounded border border-gray-800">
                      {(f.size / 1024 / 1024).toFixed(1)} MB
                    </span>
                    <button
                      onClick={() => setBundle((b) => b.filter((_, j) => j !== i))}
                      disabled={bundleRunning}
                      className="text-red-400 hover:text-red-500 font-bold hover:underline disabled:opacity-30"
                    >
                      حذف
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* SECTION 5: CUSTOM SHELL COMMANDS */}
        <section className="rounded-2xl border border-[#1E293B]/60 bg-[#111827]/60 backdrop-blur-xl p-5 shadow-lg lg:col-span-3 relative overflow-hidden group hover:border-cyan-500/20 transition-all duration-300">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xl">💻</span>
            <h2 className="font-extrabold text-gray-200 text-sm">منفذ أوامر Shell مخصص</h2>
          </div>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <span className="absolute left-3 top-3 font-mono font-bold text-cyan-500 text-xs">$</span>
              <input
                value={customCmd}
                onChange={(e) => setCustomCmd(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && onRunCustom()}
                placeholder="getprop ro.product.model"
                className="w-full rounded-xl border border-[#1E293B] bg-[#0B0F19]/90 pl-3 pr-7 py-2.5 font-mono text-xs text-green-400 focus:outline-none focus:border-cyan-500/40"
                dir="ltr"
              />
            </div>
            <button
              onClick={onRunCustom}
              disabled={!conn || busy}
              className="rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-5 py-2.5 text-xs font-black text-white hover:from-cyan-400 hover:to-blue-500 disabled:opacity-30 transition-all"
            >
              ⚙️ تنفيذ الأمر
            </button>
          </div>
        </section>

        {/* SECTION 6: SYSTEM LIVE LOGS */}
        <section className="rounded-2xl border border-[#1E293B]/60 bg-[#111827]/60 backdrop-blur-xl p-5 shadow-lg lg:col-span-3 relative overflow-hidden">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xl">📋</span>
            <h2 className="font-extrabold text-gray-200 text-sm">سجل العمليات المباشر (Console Logs)</h2>
          </div>
          <div
            ref={logRef}
            dir="ltr"
            className="h-64 overflow-auto rounded-xl bg-[#070A13] p-3 font-mono text-[11px] text-gray-300 border border-gray-800 shadow-inner custom-scrollbar leading-relaxed"
          >
            {logs.length === 0 ? (
              <div className="text-gray-600 italic flex items-center justify-center h-full">😴 لا توجد سجلات عمليات جارية حالياً، بانتظار اتصال الشاشة...</div>
            ) : (
              logs.map((l, i) => (
                <div
                  key={i}
                  className={`py-0.5 border-b border-gray-900/40 transition-colors duration-150 hover:bg-gray-900/30 ${
                    l.kind === "err"
                      ? "text-rose-400 bg-rose-500/5 px-1 rounded"
                      : l.kind === "ok"
                        ? "text-emerald-400 bg-emerald-500/5 px-1 rounded"
                        : "text-gray-300"
                  }`}
                >
                  <span className="text-gray-500 font-semibold select-none">[{l.time}]</span>{" "}
                  <span className="whitespace-pre-wrap">{l.text}</span>
                </div>
              ))
            )}
          </div>
        </section>

        {/* SECTION 7: IMPORTANT USER MANUAL */}
        <section className="rounded-2xl border border-amber-500/10 bg-amber-500/5 p-5 lg:col-span-3 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xl">💡</span>
            <h2 className="font-extrabold text-amber-400 text-sm">تعليمات وإرشادات التشغيل الهامة</h2>
          </div>
          <ol className="list-inside list-decimal space-y-2 text-xs text-gray-400 leading-relaxed">
            <li>يجب تصفح المنصة بشكل كامل عبر متصفحات <b className="text-gray-200">Chrome</b> أو <b className="text-gray-200">Edge</b> من خلال الكمبيوتر المكتبي أو المحمول (خاصية WebUSB غير مدعومة نهائياً على نظام iOS للهواتف).</li>
            <li>
              <b className="text-amber-400/90">إعداد الشاشة:</b> توجه لقائمة إعدادات شاشة السيارة/الجهاز، وقم بتفعيل خيارات المطور <b className="text-gray-200">Developer Options</b>، ثم تفعيل خيار تصحيح أخطاء USB المسمى <b className="text-gray-200">USB debugging</b>. في بعض شاشات سيارات الـ AAOS، قد تحتاج أيضاً لتفعيل خيار <b className="text-gray-200">ADB over USB</b> بشكل خاص.
            </li>
            <li>قم بتوصيل كابل نقل البيانات USB الأصلي بين الكمبيوتر والشاشة، ثم اضغط على زر <b className="text-cyan-400">"توصيل جهاز USB الشاشة"</b> بالأعلى واختر جهازك من القائمة المنبثقة.</li>
            <li>عند عملية الربط لأول مرة، ستظهر لك نافذة منبثقة تأكيدية على شاشة السيارة نصها <b className="text-gray-200">"Allow USB debugging?"</b>، يرجى الموافقة عليها ومنح الصلاحية دائماً لكي يستجيب معك النظام هنا.</li>
            <li>لمستخدمي أنظمة ويندوز (Windows): في حال تعذر لقط الجهاز، قد يتطلب الأمر تحديث أو تثبيت تعريفات <i className="text-cyan-400 font-mono">Google USB Driver</i> الرسمية أو تحويل الوصلة إلى WinUSB باستخدام أداة <b className="text-gray-200">Zadig</b> المشهورة ليظهر بنجاح داخل المتصفح.</li>
          </ol>
        </section>
      </main>
    </div>
  );
}
