"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { RotateCw, AlertCircle, X, ExternalLink } from "lucide-react";
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
      if (e.data && e.data.type === "PUP_PREVIEW_ERROR") {
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

    // Combine all CSS
    const combinedCss = cssFiles.map((f) => `/* ${f.filename} */\n${f.content}`).join("\n");

    // Combine all JS
    const combinedJs = jsFiles.map((f) => `// ${f.filename}\n${f.content}`).join("\n");

    // Error capture harness
    const errorCatcherScript = `
<script>
  window.onerror = function(msg, url, lineNo, columnNo, error) {
    try {
      window.parent.postMessage({
        type: 'PUP_PREVIEW_ERROR',
        message: msg ? msg.toString() : 'Runtime Error',
        filename: url ? url.split('/').pop() : '',
        lineno: lineNo
      }, '*');
    } catch(e) {}
    return false;
  };
</script>
`;

    // Inject CSS into head and JS into body
    let html = indexHtml;

    // Inject error catcher right after <head> or at start
    if (html.includes("<head>")) {
      html = html.replace("<head>", `<head>\n${errorCatcherScript}\n<style>\n${combinedCss}\n</style>`);
    } else {
      html = `${errorCatcherScript}\n<style>\n${combinedCss}\n</style>\n${html}`;
    }

    // Replace external script tags matching local files or append all JS to body
    // Remove local <script src="..."> references to avoid 404s
    html = html.replace(/<script\s+src=["'](?!http)([^"']+)["']\s*><\/script>/gi, (match, src) => {
      const matchedJs = files.find((f) => f.filename === src);
      if (matchedJs) {
        return `<script>\n// Inlined: ${matchedJs.filename}\n${matchedJs.content}\n</script>`;
      }
      return match;
    });

    // If script wasn't already inlined by src replacement, inject remaining JS before </body>
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
    <div className="h-full flex flex-col bg-zinc-950 overflow-hidden select-none">
      {/* Preview header */}
      <div className="h-9 bg-zinc-900/90 border-b border-zinc-800 flex items-center justify-between px-3 shrink-0">
        <div className="flex items-center space-x-2 text-xs font-mono text-zinc-300">
          <span className="font-semibold text-zinc-200 uppercase tracking-wider text-[11px]">
            Game Canvas
          </span>
          <span className="text-zinc-600">|</span>
          <span className="text-[10px] text-zinc-500">1:1 Sandboxed</span>
        </div>

        <div className="flex items-center space-x-2">
          {errors.length > 0 && (
            <button
              onClick={() => setShowConsole(!showConsole)}
              className="flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-red-950/80 text-red-300 border border-red-800 hover:bg-red-900/80 transition-colors cursor-pointer"
            >
              <AlertCircle className="w-3 h-3" />
              <span>{errors.length} error{errors.length > 1 ? "s" : ""}</span>
            </button>
          )}

          <button
            onClick={reloadIframe}
            title="Reload Preview"
            className="p-1 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors cursor-pointer"
          >
            <RotateCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Embedded Iframe */}
      <div className="flex-1 bg-black relative overflow-hidden flex items-center justify-center">
        <iframe
          ref={iframeRef}
          title="Game Preview"
          srcDoc={bundledHtml}
          sandbox="allow-scripts allow-modals allow-same-origin"
          className="w-full h-full border-none bg-black"
        />
      </div>

      {/* Mini Runtime Error Console */}
      {showConsole && errors.length > 0 && (
        <div className="h-32 bg-zinc-950 border-t border-red-900/80 flex flex-col text-xs font-mono shrink-0">
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
