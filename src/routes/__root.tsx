import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0B0F19] px-4 text-white">
      <div className="max-w-md text-center border border-cyan-500/20 bg-[#111827]/60 backdrop-blur-xl p-8 rounded-2xl shadow-[0_0_30px_rgba(6,182,212,0.15)]">
        <h1 className="text-7xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500 animate-pulse">404</h1>
        <h2 className="mt-4 text-xl font-bold tracking-tight">الصفحة غير موجودة 🗺️</h2>
        <p className="mt-2 text-sm text-gray-400">
          يبدو أنك ضللت الطريق، هذه الصفحة غير متوفرة في النظام.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-5 py-2.5 text-sm font-bold text-white transition-all duration-300 hover:from-cyan-400 hover:to-blue-500 hover:shadow-[0_0_15px_rgba(6,182,212,0.4)]"
          >
            العودة للرئيسية 🏠
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0B0F19] px-4 text-white">
      <div className="max-w-md text-center border border-red-500/20 bg-[#111827]/60 backdrop-blur-xl p-8 rounded-2xl shadow-[0_0_30px_rgba(239,68,68,0.15)]">
        <h1 className="text-xl font-bold tracking-tight text-red-400 flex items-center justify-center gap-2">
          🚨 تعذر تحميل هذه الصفحة
        </h1>
        <p className="mt-2 text-sm text-gray-400">
          حدث خطأ غير متوقع في النظام. يمكنك المحاولة مجدداً.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-red-500 to-rose-600 px-5 py-2.5 text-sm font-bold text-white transition-all duration-300 hover:from-red-400 hover:to-rose-500 hover:shadow-[0_0_15px_rgba(239,68,68,0.4)]"
          >
            أعد المحاولة 🔄
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-xl border border-gray-700 bg-[#1F2937]/50 px-5 py-2.5 text-sm font-bold text-gray-300 transition-colors hover:bg-[#1F2937] hover:text-white"
          >
            الرئيسية 🏠
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "CarADB — التحكم الذكي في شاشات السيارات عبر ADB" },
      {
        name: "description",
        content:
          "أداة متطورة لتوصيل وإدارة شاشات السيارات (Android Auto / AAOS) عبر ADB وتثبيت حزم APK ومنح الأذونات مباشرة.",
      },
      { name: "author", content: "CarADB" },
      { property: "og:title", content: "CarADB — التحكم الذكي في شاشات السيارات عبر ADB" },
      {
        property: "og:description",
        content: "توصيل متطور، تثبيت حزم APK، ومنح الأذونات من المتصفح مباشرة عبر WebUSB.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className="dark bg-[#070A13]">
      <head>
        <HeadContent />
      </head>
      <body className="text-gray-100 antialiased selection:bg-cyan-500/30 selection:text-cyan-200 min-h-screen">
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
    </QueryClientProvider>
  );
}
