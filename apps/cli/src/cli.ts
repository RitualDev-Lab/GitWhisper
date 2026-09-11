import type { CommitStyle } from "@gitwhisper/config";
import { type CheckOptions, runCheck } from "./commands/check.js";
import { runConfigWizard } from "./commands/config.js";
import { type GenerateOptions, runGenerate } from "./commands/generate.js";
import { runHookExec } from "./commands/hook-exec.js";
import { type HooksOptions, runHooks } from "./commands/hooks.js";
import { runIssue } from "./commands/issue.js";
import { type PlanCommandOptions, runPlan } from "./commands/plan.js";
import { type PrivacyCommandOptions, runPrivacy } from "./commands/privacy.js";
import { type SplitCommandOptions, runSplit } from "./commands/split.js";
import { type StyleCommandOptions, runStyle } from "./commands/style.js";
import { type TimelineCommandOptions, runTimeline } from "./commands/timeline.js";
import { setDebug } from "./debug.js";
import { colors, printHeader } from "./ui/terminal.js";

const VERSION = "0.9.0";

function printHelp(): void {
  printHeader();
  console.log(` Usage:
   gitwhisper [command] [options]

 Commands:
   generate        Analyze staged changes and generate commit (default)
   check [target]  Evaluate commit message quality against policy and staged changes
   hooks [action]  Manage Git hooks (install, uninstall, status)
   hook [type]     Execute specific git hook logic
   issue [key]     Inspect branch work-item context and relevance to staged changes
   privacy         Scan staged changes for sensitive credentials and secrets
   plan            Analyze staged changes and display commit splitting plan
   split           Split staged changes into multiple atomic commits safely
   timeline        Inspect historical workstreams and commit timeline
   style           Inspect local repository commit style and learned conventions
   config, init    Interactive configuration wizard for AI providers

 Options:
   --force                 Force hook installation or chaining
   --mode <mode>           Hook mode: "off", "warn", or "strict" (default: warn)
   --issue <key>           Specify work-item/issue key (e.g. DEV-142, #123)
   --work-item <key>       Alias for --issue
   -p, --provider <name>   Select AI provider: "ollama" or "openai-compatible"
   --model <name>          Specify model name (e.g. qwen2.5-coder:7b, gpt-4o-mini)
   --variant <style>       Default variant: "concise", "descriptive", or "detailed"
   --style <style>         Override commit style: "auto", "conventional", or "simple"
   --editor <editor>       External editor to launch for editing (e.g. "nano", "vim", "code")
   --no-history            Disable repository history learning
   --no-split              Disable commit split suggestions
   --history-limit <n>     Number of historical commits to analyze (default: 50)
   --json                  Output machine-readable JSON
   --details               Show extended evidence/graph (for style and plan commands)
   -q, --quiet             Suppress non-essential output
   --no-color              Disable ANSI color codes
   --dry-run               Simulate execution without modifying Git state
   --debug                 Enable verbose diagnostic logging
   -h, --help              Show this help message
   -v, --version           Show version number
 `);
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  let command = "generate";
  let issueKey: string | undefined;
  let checkTarget: string | undefined;
  let hooksAction: string | undefined;
  let hookType: string | undefined;
  let hookFile: string | undefined;

  const genOptions: GenerateOptions = {};
  const styleOptions: StyleCommandOptions = {};
  const planOptions: PlanCommandOptions = {};
  const splitOptions: SplitCommandOptions = {};
  const privacyOptions: PrivacyCommandOptions = {};
  const checkOptions: CheckOptions = {};
  const hooksOptions: HooksOptions = {};
  const timelineOptions: TimelineCommandOptions = {};

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      printHelp();
      return;
    }

    if (arg === "--version" || arg === "-v") {
      console.log(`gitwhisper v${VERSION}`);
      return;
    }

    if (arg === "--debug") {
      setDebug(true);
      i++;
      continue;
    }

    if (arg === "--dry-run") {
      genOptions.dryRun = true;
      splitOptions.dryRun = true;
      i++;
      continue;
    }

    if (arg === "--no-body") {
      genOptions.noBody = true;
      i++;
      continue;
    }

    if (arg === "--no-split") {
      genOptions.noSplit = true;
      i++;
      continue;
    }

    if (arg === "--no-history") {
      genOptions.noHistory = true;
      i++;
      continue;
    }

    if (arg === "--staged") {
      privacyOptions.staged = true;
      i++;
      continue;
    }

    if (arg === "--json") {
      genOptions.json = true;
      styleOptions.json = true;
      planOptions.json = true;
      privacyOptions.json = true;
      checkOptions.json = true;
      hooksOptions.json = true;
      timelineOptions.json = true;
      i++;
      continue;
    }

    if (arg === "--strict") {
      checkOptions.strict = true;
      i++;
      continue;
    }

    if (arg === "--ai") {
      checkOptions.ai = true;
      i++;
      continue;
    }

    if (arg === "--force") {
      hooksOptions.force = true;
      i++;
      continue;
    }

    if (arg === "--mode" || arg.startsWith("--mode=")) {
      const val = arg.includes("=") ? arg.split("=")[1] : argv[i + 1];
      if (val === "off" || val === "warn" || val === "strict") {
        hooksOptions.mode = val;
      } else {
        console.error(`Unknown hook mode: "${val}". Must be "off", "warn", or "strict".`);
        process.exit(1);
      }
      i += arg.includes("=") ? 1 : 2;
      continue;
    }

    if (arg === "--message" || arg.startsWith("--message=")) {
      const val = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : argv[i + 1];
      checkOptions.message = val;
      i += arg.includes("=") ? 1 : 2;
      continue;
    }

    if (arg === "-q" || arg === "--quiet") {
      genOptions.quiet = true;
      i++;
      continue;
    }

    if (arg === "--no-color") {
      genOptions.noColor = true;
      i++;
      continue;
    }

    if (arg === "--variant" || arg.startsWith("--variant=")) {
      const val = arg.includes("=") ? arg.split("=")[1] : argv[i + 1];
      if (val === "concise" || val === "descriptive" || val === "detailed") {
        genOptions.variant = val;
      } else {
        console.error(
          `Unknown variant: "${val}". Must be "concise", "descriptive", or "detailed".`,
        );
        process.exit(1);
      }
      i += arg.includes("=") ? 1 : 2;
      continue;
    }

    if (arg === "--editor" || arg.startsWith("--editor=")) {
      const val = arg.includes("=") ? arg.split("=")[1] : argv[i + 1];
      genOptions.editor = val;
      i += arg.includes("=") ? 1 : 2;
      continue;
    }

    if (arg === "--details") {
      styleOptions.details = true;
      planOptions.details = true;
      privacyOptions.details = true;
      timelineOptions.details = true;
      i++;
      continue;
    }

    if (arg === "--level" || arg.startsWith("--level=")) {
      const val = arg.includes("=") ? arg.split("=")[1] : argv[i + 1];
      if (val === "file" || val === "hunk" || val === "auto") {
        planOptions.level = val;
      } else {
        console.error(`Unknown level: "${val}". Must be "auto", "file", or "hunk".`);
        process.exit(1);
      }
      i += arg.includes("=") ? 1 : 2;
      continue;
    }

    if (arg === "--scope") {
      const scopeVal = argv[i + 1];
      genOptions.commit = { ...genOptions.commit, scopes: [scopeVal] };
      timelineOptions.scope = scopeVal;
      i += 2;
      continue;
    }

    if (arg === "--type") {
      const typeVal = argv[i + 1];
      genOptions.commit = { ...genOptions.commit, allowedTypes: [typeVal] };
      i += 2;
      continue;
    }

    if (arg === "--history-limit" || arg === "--limit") {
      const val = Number.parseInt(argv[i + 1], 10);
      if (Number.isNaN(val) || val <= 0) {
        console.error("Invalid limit. Must be a positive number.");
        process.exit(1);
      }
      genOptions.history = { ...genOptions.history, limit: val };
      styleOptions.limit = val;
      timelineOptions.limit = val;
      i += 2;
      continue;
    }

    if (arg === "--style") {
      const styleVal = argv[i + 1] as CommitStyle;
      if (["auto", "conventional", "simple"].includes(styleVal)) {
        genOptions.commit = { ...genOptions.commit, style: styleVal };
        checkOptions.style = styleVal;
      } else {
        console.error(`Unknown style: "${styleVal}". Must be "auto", "conventional", or "simple".`);
        process.exit(1);
      }
      i += 2;
      continue;
    }

    if (arg === "-p" || arg === "--provider") {
      const val = argv[i + 1];
      if (val === "ollama" || val === "openai-compatible") {
        genOptions.provider = val;
      } else {
        console.error(`Unknown provider: "${val}". Must be "ollama" or "openai-compatible".`);
        process.exit(1);
      }
      i += 2;
      continue;
    }

    if (arg === "--model" || arg.startsWith("--model=")) {
      const val = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : argv[i + 1];
      genOptions.model = val;
      i += arg.includes("=") ? 1 : 2;
      continue;
    }

    if (arg === "-m") {
      const val = argv[i + 1];
      if (command === "check" || argv.includes("check")) {
        checkOptions.message = val;
      } else {
        genOptions.model = val;
      }
      i += 2;
      continue;
    }

    if (arg === "--issue" || arg === "--work-item") {
      genOptions.issue = argv[i + 1];
      issueKey = argv[i + 1];
      i += 2;
      continue;
    }

    if (arg === "--base-url") {
      genOptions.baseUrl = argv[i + 1];
      i += 2;
      continue;
    }

    if (!arg.startsWith("-")) {
      if (arg === "config" || arg === "init") {
        command = "config";
      } else if (arg === "check") {
        command = "check";
        if (argv[i + 1] && !argv[i + 1].startsWith("-")) {
          checkTarget = argv[i + 1];
          i++;
        }
      } else if (arg === "hooks") {
        command = "hooks";
        if (argv[i + 1] && !argv[i + 1].startsWith("-")) {
          hooksAction = argv[i + 1];
          i++;
        }
      } else if (arg === "hook") {
        command = "hook";
        if (argv[i + 1] && !argv[i + 1].startsWith("-")) {
          hookType = argv[i + 1];
          i++;
        }
        if (argv[i + 1] && !argv[i + 1].startsWith("-")) {
          hookFile = argv[i + 1];
          i++;
        }
      } else if (arg === "issue") {
        command = "issue";
        if (argv[i + 1] && !argv[i + 1].startsWith("-")) {
          issueKey = argv[i + 1];
          i++;
        }
      } else if (arg === "privacy") {
        command = "privacy";
        if (argv[i + 1] === "scan") {
          i++;
        }
      } else if (arg === "style") {
        command = "style";
      } else if (arg === "plan") {
        command = "plan";
      } else if (arg === "split") {
        command = "split";
      } else if (arg === "timeline") {
        command = "timeline";
      } else if (arg === "generate") {
        command = "generate";
      } else {
        console.error(`Unknown command: "${arg}". Use --help for usage.`);
        process.exit(1);
      }
      i++;
      continue;
    }

    console.error(`Unknown option: "${arg}". Use --help for usage.`);
    process.exit(1);
  }

  if (command === "config") {
    await runConfigWizard();
  } else if (command === "issue") {
    await runIssue(issueKey, { json: genOptions.json });
  } else if (command === "privacy") {
    await runPrivacy("scan", privacyOptions);
  } else if (command === "style") {
    await runStyle(styleOptions);
  } else if (command === "plan") {
    await runPlan(planOptions);
  } else if (command === "split") {
    await runSplit(splitOptions);
  } else if (command === "timeline") {
    await runTimeline(timelineOptions);
  } else if (command === "check") {
    await runCheck(checkTarget, checkOptions);
  } else if (command === "hooks") {
    await runHooks(hooksAction, hooksOptions);
  } else if (command === "hook") {
    if (!hookType || !hookFile) {
      console.error("Usage: gitwhisper hook commit-msg <file>");
      process.exit(1);
    }
    await runHookExec(hookType, hookFile);
  } else {
    await runGenerate(genOptions);
  }
}
