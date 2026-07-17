disabled:opacity-50"
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
lg:col-span-3">
          <div className="mb-4 flex items-center justify-between flex-col sm:flex-row gap-3">
            <div>
              <h2 className="font-bold text-lg text-slate-200">📦 حزمة تطبيقاتك الخاصة</h2>
              <p className="text-xs text-slate-400 mt-1">تثبيت سلس وتلقائي لعدة تطبيقات واحداً تلو الآخر</p>
            </div>
            <div className="flex gap-2 w-full sm:w-auto">
              <label className="flex-1 sm:flex-initial text-center cursor-pointer rounded-xl border border-slate-800 hover:border-slate-700 bg-[#070d1e] px-4 py-2 text-xs font-bold text-slate-300 transition-colors">
                إضافة ملفات للـ Bundle
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
                {bundleRunning ? "جاري التثبيت تلقائياً..." : "بدء تثبيت الحزمة"}
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

      </main>

      {/* قسم السجلات والـ Logs المعزز */}
      <section className="mx-auto max-w-6xl px-4 mt-6">
        <div className="rounded-2xl border border-slate-800 bg-[#070d1e] p-5 shadow-inner">
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-bold text-sm text-slate-300">📟 وحدة التحكم والـ Logs للمطور SAM_T2</h3>
            <button 
              onClick={() => setLogs([])}
              className="text-[10px] text-slate-500 hover:text-slate-300"
            >
              مسح السجل
            </button>
          </div>
          <div 
            ref={logRef}
            className="h-48 overflow-y-auto rounded-xl bg-slate-950/90 p-4 font-mono text-xs space-y-1.5 scrollbar-thin"
          >
            {logs.length === 0 ? (
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