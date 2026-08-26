import { defineConfig } from "eslint/config";
import next from "eslint-config-next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig([{
    // Agent-owned build dirs (scripts/agent-dev.mjs, scripts/agent-build.mjs).
    // eslint-config-next ignores .next by default but knows nothing about these,
    // so without this `eslint .` lints generated webpack output and fails.
    ignores: [".next-*/**", ".agent/**"],
}, {
    extends: [...next],
}, {
    files: [
        "lib/hooks/useStoryVideoExport.ts",
        "lib/storyboard/export-*.ts",
    ],
    rules: {
        "no-restricted-imports": ["error", {
            patterns: [{
                group: [
                    "@/lib/reel/timeline",
                    "@/lib/reel/renderer",
                    "@/lib/hooks/useReelVideoExport",
                ],
                message: "Story export timing and rendering must remain independent from reel export modules.",
            }],
        }],
    },
}, {
    files: [
        "lib/hooks/useReelVideoExport.ts",
        "lib/reel/timeline.ts",
        "lib/reel/renderer.ts",
    ],
    rules: {
        "no-restricted-imports": ["error", {
            patterns: [{
                group: [
                    "@/lib/storyboard/export-timeline",
                    "@/lib/storyboard/export-renderer",
                    "@/lib/hooks/useStoryVideoExport",
                ],
                message: "Reel export timing and rendering must remain independent from story export modules.",
            }],
        }],
    },
}]);
