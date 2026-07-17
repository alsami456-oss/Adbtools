import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Adb } from "@yume-chan/adb";
import type { AdbDaemonWebUsbDevice } from "@yume-chan/adb-daemon-webusb";
import { 
  UsbIcon, 
  SettingsIcon, 
  FolderDownIcon, 
  TrashIcon, 
  TelegramIcon, 
  GithubIcon, 
  PlayIcon 
} from "../components/Icons";
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

  // أوامر مخصصة للسيارة للتنفيذ بنقرة واحدة
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
      // محاولة إيقاف المشغلات الشائعة لفرض إعادة التشغيل
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
              متوافق بالكامل مع شاشات جيتور T2 وشانجان UNI-K
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
                <UsbIcon className="w-4 h-4" />
                {connecting ? "جاري الاتصال…" : "توصيل جهاز USB"}
              </button>
            )}
            
            {/* زر الدعم الفني تيليجرام */}
            <a 
              href="https://t.me/SAM_T2"
              target="_blank" 
              rel="noopener noreferrer"
              className="flex items-center gap-2 bg-[#10b981] hover:bg-[#059669] text-slate-950 transition-colors px-4 py-2.5 rounded-xl text-sm font-bold shadow-lg shadow-[#10b981]/20"
            >
              <TelegramIcon className="w-4 h-4" />
              الدعم الفني تيليجرام
            </a>
          </div>
        </div>
      </header>

      {!supported && (
        <div className="mx-auto mt-4 max-w-6xl rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400 text-center">
          متصفحك لا يدعم WebUSB. استخدم Chrome أو Edge على كمبيوتر (سطح مكتب).
        </div>
      )}

      <main className="mx-auto grid max-w-6xl gap-6 p-4 lg:grid-cols-3 mt-6">
        
        {/* قسم تثبيت حزم APK */}
        <section className="rounded-2xl border border-slate-800 bg-[#0b1329] p-5 shadow-xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-[#10b981]/5 rounded-full blur-2xl" />
          <div className="flex items-center gap-2 mb-2 text-[#10b981]">
            <FolderDownIcon className="w-5 h-5" />
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
            <h2 className="font-bold text-lg text-slate-200">الحزم المثبتة بالسيارة</h2>
            <button
              disabled={!conn || busy}
              onClick={() => conn && refreshPackages(conn.adb)}
              className="rounded-lg border border-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-[#070d1e] hover:border-slate-700 transition-all disabled:opacity-50"
            >
              تحديث القائمة
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
            إلغاء تثبيت الحزمة المحددة نهائياً
          </button>
        </section>

        {/* قسم إدارة أذونات النظام والأكواد */}
        <section className="rounded-2xl border border-slate-800 bg-[#0b1329] p-5 shadow-xl">
          <div className="flex items-center gap-2 mb-3 text-yellow-500">
            <SettingsIcon className="w-5 h-5" />
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

        {/* قسم حزمة تطبيقات التثبيت التلقائي */}
        <section className="rounded-2xl border border-slate-800 bg-[#0b1329] p-5 shadow-xl lg:col-span-3">
          <div className="mb-4 flex items-center justify-between flex-col sm:flex-row gap-3">
            <div>
              <h2 className="font-bold text-lg text-slate-200">📦 حزمة تطبيقاتك الخاصة</h2>
              <p className="text-xs text-slate-400 mt-1">تثبيت سلس وتلقائي لعدة تطبيقات واحداً تلو الآخر</p>
            </div>
            <div className="flex gap-2 w-full sm:w-auto">
              <label className="flex-1 sm:flex-initial text-center cursor-pointer rounded-xl border border-slate-800 hover:border-slate-700 bg-[#070d1e] px-4 py-2 text-xs font-bold text-slate-300 transition-colors">
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
                className="rounded-xl border border-rose-950/30 text-rose-400 px-4 py-2 text-xs font-bold hover:bg-rose-950/20 disabled:opacity-50"
              >
                مسح
              </button>
              <button
                onClick={onInstallBundle}
                disabled={!conn || bundle.length === 0 || bundleRunning}
                className="rounded-xl bg-[#10b981] hover:bg-[#059669] text-slate-950 px-5 py-2 text-xs font-bold transition-all disabled:opacity-50"
              >
                {bundleRunning ? "جاري التثبيت…" : `تثبيت الكل (${bundle.length})`}
              </button>
            </div>
          </div>
          {bundle.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-6 bg-[#070d1e] rounded-xl border border-slate-800">
              لا توجد ملفات حالياً. أضف ملفات APK لتكوين حزمتك لتثبيتها بضغطة زر واحدة.
            </p>
          ) : (
            <ul className="divide-y divide-slate-800 rounded-xl border border-slate-800 bg-[#070d1e] overflow-hidden">
              {bundle.map((f, i) => (
                <li key={f.name + i} className="flex items-center justify-between px-4 py-3 text-xs">
                  <span className="truncate font-mono font-medium text-slate-300">
                    {i + 1}. {f.name}
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="text-slate-500 font-medium">
                      {(f.size / 1024 / 1024).toFixed(1)} MB
                    </span>
                    <button
                      onClick={() => setBundle((b) => b.filter((_, j) => j !== i))}
                      disabled={bundleRunning}
                      className="text-rose-400 hover:text-rose-300 transition-colors"
                    >
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* قسم إدارة أذونات النظام السريعة بنقرة واحدة */}
        <section className="bg-[#0b1329] border border-slate-800 rounded-2xl p-5 shadow-xl lg:col-span-3">
          <div className="flex items-center gap-2 mb-2 text-[#10b981]">
            <SettingsIcon className="w-5 h-5" />
            <h2 className="text-lg font-bold">🛠️ إدارة أذونات النظام والأوامر السريعة</h2>
          </div>
          <p className="text-xs text-slate-400 mb-5 leading-relaxed">
            أوامر سريعة بنقرة زر واحدة لتعديل بيئة النظام على سيارتك مباشرة للتطبيق المحدد بالأعلى دون الحاجة لكتابة أكواد يدوية:
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <button 
              onClick={onGrantStoragePermission}
              disabled={!conn || !selectedPkg || busy}
              className="flex flex-col items-start p-4 bg-[#070d1e] hover:bg-[#091124] hover:border-[#10b981]/30 border border-slate-800 rounded-xl text-right transition-all group disabled:opacity-50"
            >
              <span className="text-sm font-bold text-slate-200 group-hover:text-white flex items-center gap-2">
                <PlayIcon className="w-3.5 h-3.5 text-[#10b981]" />
                منح صلاحيات الذاكرة للتطبيق المختار
              </span>
              <span className="text-[10px] text-slate-500 mt-1">Storage Permission (WRITE/READ_EXTERNAL_STORAGE)</span>
            </button>
            
            <button 
              onClick={onForceStopLauncher}
              disabled={!conn || busy}
              className="flex flex-col items-start p-4 bg-[#070d1e] hover:bg-[#091124] hover:border-yellow-500/30 border border-slate-800 rounded-xl text-right transition-all group disabled:opacity-50"
            >
              <span className="text-sm font-bold text-slate-200 group-hover:text-white flex items-center gap-2">
                <PlayIcon className="w-3.5 h-3.5 text-yellow-500" />
                إعادة تشغيل واجهة السيارة (Force Stop)
              </span>
              <span className="text-[10px] text-slate-500 mt-1">لإصلاح تعليق الشاشة أو إعادة تحميل التطبيقات الافتراضية</span>
            </button>
          </div>
        </section>

        {/* قسم أمر shell مخصص */}
        <section className="rounded-2xl border border-slate-800 bg-[#0b1329] p-5 shadow-xl lg:col-span-3">
          <h2 className="mb-2 font-bold text-lg text-slate-200">تنفيذ أمر shell مخصص</h2>
          <p className="text-xs text-slate-400 mb-3">للمحترفين: اكتب أي كود برمي لمعالجته مباشرة على نظام الشاشة</p>
          <div className="flex gap-3 flex-col sm:flex-row">
            <input
              value={customCmd}
              onChange={(e) => setCustomCmd(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onRunCustom()}
              placeholder="getprop ro.product.model"
              className="flex-1 rounded-xl border border-slate-800 bg-[#070d1e] px-4 py-3 font-mono text-sm text-slate-200 focus:outline-none focus:border-blue-500/50"
              dir="ltr"
            />
            <button
              onClick={onRunCustom}
              disabled={!conn || busy}
              className="rounded-xl bg-[#2563eb] hover:bg-blue-600 text-white px-6 py-3 text-sm font-bold transition-all disabled:opacity-50 shadow-lg shadow-blue-900/10"
            >
              تنفيذ الأمر
            </button>
          </div>
        </section>

        {/* قسم السجل (Logs) */}
        <section className="rounded-2xl border border-slate-800 bg-[#0b1329] p-5 shadow-xl lg:col-span-3">
          <h2 className="mb-3 font-bold text-lg text-slate-200">سجل عمليات المنصة (Logs)</h2>
          <div
            ref={logRef}
            dir="ltr"
            className="h-64 overflow-auto rounded-xl bg-[#050a17] border border-slate-800/80 p-3 font-mono text-xs text-slate-300 leading-relaxed"
          >
            {logs.length === 0 ? (
              <div className="text-slate-600 text-center py-12">لا توجد سجلات عمليات حالية للمنصة.</div>
            ) : (
              logs.map((l, i) => (
                <div
                  key={i}
                  className={
                    l.kind === "err"
                      ? "text-rose-400 bg-rose-500/5 px-2 py-0.5 rounded"
                      : l.kind === "ok"
                        ? "text-emerald-400 bg-emerald-500/5 px-2 py-0.5 rounded"
                        : "px-2 py-0.5 text-slate-300"
                  }
                >
                  <span className="text-slate-500">[{l.time}]</span>{" "}
                  <span className="whitespace-pre-wrap">{l.text}</span>
                </div>
              ))
            )}
          </div>
        </section>

        {/* قسم التعليمات والإرشادات */}
        <section className="rounded-2xl border border-slate-800 bg-[#0b1329]/60 p-5 shadow-xl lg:col-span-3">
          <h2 className="mb-3 font-bold text-lg text-[#10b981]">💡 إرشادات مهمة لضمان نجاح التوصيل</h2>
          <ol className="list-inside list-decimal space-y-2 text-sm text-slate-400 leading-relaxed">
            <li>يجب استخدام متصفح يدعم تقنية WebUSB (مثل Chrome أو Edge) على جهاز الكمبيوتر الخاص بك.</li>
            <li>
              <b>على شاشة السيارة:</b> تأكد من تفعيل <b>خيارات المطور (Developer Options)</b> ثم تفعيل <b>تصحيح أخطاء USB (USB debugging)</b>. في بعض شاشات جيتور T2 وشانجان قد تحتاج لتفعيل <b>ADB over USB</b> بشكل مستقل.
            </li>
            <li>وصّل كابل USB من جوالك/الكمبيوتر إلى المنفذ المخصص للشاشة في السيارة، ثم اضغط على زر "توصيل جهاز USB" العلوي.</li>
            <li>عند نجاح الربط لأول مرة، قد تظهر لك رسالة تأكيد "Allow USB debugging?" على شاشة السيارة، يرجى الموافقة عليها فوراً للاستمرار.</li>
            <li>لمستخدمي نظام ويندوز: في حال عدم ظهور جهازك، يرجى تثبيت تعاريف <i>Google USB Driver</i> الرسمية.</li>
          </ol>
        </section>

        {/* بطاقة التواصل الاجتماعي للدعم الفني */}
        <section className="bg-gradient-to-l from-[#0c142b] to-[#0b1329] border border-blue-900/30 rounded-2xl p-6 shadow-xl text-center lg:col-span-3">
          <h3 className="text-base font-bold text-slate-200 mb-2">💬 هل واجهت أي مشكلة أثناء البرمجة أو تحتاج لمساعدة؟</h3>
          <p className="text-xs text-slate-400 mb-5">يسعدني تواصلك معي مباشرة للاستفسارات التقنية أو الدعم الفني لشاشات السيارات</p>
          
          <div className="flex flex-wrap justify-center gap-3">
            {/* حساب تيليجرام */}
            <a 
              href="https://t.me/SAM_T2"
              target="_blank" 
              rel="noopener noreferrer"
              className="flex items-center gap-2 bg-[#229ED9]/10 hover:bg-[#229ED9]/20 text-[#229ED9] border border-[#229ED9]/30 px-5 py-2.5 rounded-xl text-xs font-bold transition-all"
            >
              <TelegramIcon className="w-4 h-4" />
              قناتي على تيليجرام: SAM_T2
            </a>

            {/* مستودع جيت هوب */}
            <a 
              href="https://github.com/alsami456-oss"
              target="_blank" 
              rel="noopener noreferrer"
              className="flex items-center gap-2 bg-slate-800/50 hover:bg-slate-800 text-slate-300 border border-slate-700 px-5 py-2.5 rounded-xl text-xs font-bold transition-all"
            >
              <GithubIcon className="w-4 h-4" />
              مستودعي على جيت هوب
            </a>
          </div>
        </section>

      </main>
    </div>
