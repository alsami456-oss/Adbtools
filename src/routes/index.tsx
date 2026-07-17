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