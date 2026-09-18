"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { RotateCw, AlertCircle, X } from "lucide-react";
import type { FileRecord } from "@/lib/db";

interface PreviewPanelProps {
  files: FileRecord[];
  runTrigger: number;
}

interface RuntimeError {
  message: string;
  source?: string;
  line?: number;
  time: string;
}

export function PreviewPanel({ files, runTrigger }: PreviewPanelProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [errors, setErrors] = useState<RuntimeError[]>([]);
  const [showConsole, setShowConsole] = useState(false);

  // Catch errors sent from inside the iframe via window.postMessage
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.data && e.data.type === "TINYAI_PREVIEW_ERROR") {
        setErrors((prev) => [
          ...prev.slice(-9), // keep last 10 errors max
          {
            message: e.data.message || "Unknown error",
            source: e.data.filename,
            line: e.data.lineno,
            time: new Date().toLocaleTimeString(),
          },
        ]);
        setShowConsole(true);
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  // Construct self-contained HTML document with inlined scripts & styles
  const bundledHtml = useMemo(() => {
    const indexHtml = files.find((f) => f.filename === "index.html")?.content || "<h1>No index.html found</h1>";

    const cssFiles = files.filter((f) => f.filename.endsWith(".css"));
    const jsFiles = files.filter((f) => f.filename.endsWith(".js"));

    // Error capture harness (runtime errors + unhandled promise rejections)
    const errorCatcherScript = `
<script>
  window.onerror = function(msg, url, lineNo, columnNo, error) {
    try {
      window.parent.postMessage({
        type: 'TINYAI_PREVIEW_ERROR',
        message: msg ? msg.toString() : 'Runtime Error',
        filename: url ? url.split('/').pop() : '',
        lineno: lineNo
      }, '*');
    } catch(e) {}
    return false;
  };
  window.addEventListener('unhandledrejection', function(event) {
    try {
      var reason = event.reason;
      var msg = reason ? (reason.message || reason.toString()) : 'Unhandled Promise Rejection';
      window.parent.postMessage({
        type: 'TINYAI_PREVIEW_ERROR',
        message: msg,
        filename: '',
        lineno: undefined
      }, '*');
    } catch(e) {}
  });
</script>
`;

    // Reset CSS ensuring canvas expands to full available width and height
    const canvasFullStyle = `
<style>
  html, body {
    margin: 0;
    padding: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: #000;
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
</style>
`;

    let html = indexHtml;

    // 1. Replace local stylesheet links with inlined styles
    html = html.replace(/<link\b([^>]*)\bhref=["'](?!https?:\/\/|\/\/)([^"']+)["']([^>]*)\/?>/gi, (match, before, href) => {
      const cleanHref = href.replace(/^\.\//, "").replace(/^\//, "");
      const matchedCss = files.find((f) => f.filename === cleanHref);
      if (matchedCss) {
        return `<style>\n/* Inlined: ${matchedCss.filename} */\n${matchedCss.content}\n</style>`;
      }
      return match;
    });

    // 2. Replace local script tags matching local files
    html = html.replace(/<script\b([^>]*)\bsrc=["'](?!https?:\/\/|\/\/)([^"']+)["']([^>]*)>([\s\S]*?)<\/script>/gi, (match, before, src) => {
      const cleanSrc = src.replace(/^\.\//, "").replace(/^\//, "");
      const matchedJs = files.find((f) => f.filename === cleanSrc);
      if (matchedJs) {
        return `<script>\n// Inlined: ${matchedJs.filename}\n${matchedJs.content}\n</script>`;
      }
      return match;
    });

    // 3. Combine remaining CSS not yet inlined
    const remainingCss = cssFiles
      .filter((f) => !html.includes(`/* Inlined: ${f.filename} */`))
      .map((f) => `/* ${f.filename} */\n${f.content}`)
      .join("\n");

    const headInjections = `${errorCatcherScript}\n${canvasFullStyle}${remainingCss ? `\n<style>\n${remainingCss}\n</style>` : ""}`;

    // Inject head styling and error catcher
    if (html.includes("<head>")) {
      html = html.replace("<head>", `<head>\n${headInjections}`);
    } else {
      html = `${headInjections}\n${html}`;
    }

    // 4. Inject remaining JS not yet inlined before </body>
    const remainingJs = jsFiles
      .filter((f) => !html.includes(`// Inlined: ${f.filename}`))
      .map((f) => `// Inlined: ${f.filename}\n${f.content}`)
      .join("\n");

    if (remainingJs.trim()) {
      if (html.includes("</body>")) {
        html = html.replace("</body>", `<script>\n${remainingJs}\n</script>\n</body>`);
      } else {
        html += `<script>\n${remainingJs}\n</script>`;
      }
    }

    return html;
  }, [files]);

  const reloadIframe = useCallback(() => {
    if (iframeRef.current) {
      iframeRef.current.srcdoc = bundledHtml;
    }
  }, [bundledHtml]);

  // Re-run whenever runTrigger increments
  useEffect(() => {
    reloadIframe();
  }, [runTrigger, reloadIframe]);

  return (
    <div className="h-full w-full bg-black relative overflow-hidden select-none">
      {/* 100% Width & Height Sandboxed Iframe */}
      <iframe
        ref={iframeRef}
        title="Game Preview"
        srcDoc={bundledHtml}
        sandbox="allow-scripts allow-modals allow-same-origin"
        className="w-full h-full border-none bg-black block"
      />

      {/* Floating minimal action controls in top-right */}
      <div className="absolute top-2 right-2 z-10 flex items-center space-x-1.5 bg-zinc-950/80 border border-zinc-800 rounded p-1 shadow-lg opacity-60 hover:opacity-100 transition-opacity">
        {errors.length > 0 && (
          <button
            onClick={() => setShowConsole(!showConsole)}
            className="flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-red-950 text-red-300 border border-red-800 hover:bg-red-900 transition-colors cursor-pointer"
          >
            <AlertCircle className="w-3 h-3" />
            <span>{errors.length} err</span>
          </button>
        )}

        <button
          onClick={reloadIframe}
          title="Reload Preview"
          className="p-1 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded transition-colors cursor-pointer"
        >
          <RotateCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Mini Runtime Error Console */}
      {showConsole && errors.length > 0 && (
        <div className="absolute bottom-0 inset-x-0 h-32 bg-zinc-950 border-t border-red-900/80 flex flex-col text-xs font-mono z-20 shadow-2xl">
          <div className="h-6 bg-red-950/60 border-b border-red-900/40 flex items-center justify-between px-2 text-[10px] text-red-300 font-medium">
            <span className="flex items-center space-x-1">
              <AlertCircle className="w-3 h-3" />
              <span>Console Error Output</span>
            </span>
            <div className="flex items-center space-x-1">
              <button
                onClick={() => setErrors([])}
                className="hover:text-red-100 px-1"
              >
                Clear
              </button>
              <button
                onClick={() => setShowConsole(false)}
                className="hover:text-red-100 p-0.5"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1 text-red-400 text-[11px]">
            {errors.map((err, idx) => (
              <div key={idx} className="leading-tight">
                <span className="text-zinc-500">[{err.time}]</span>{" "}
                <span className="font-semibold">{err.message}</span>{" "}
                {err.source && (
                  <span className="text-zinc-500">
                    ({err.source}:{err.line})
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
