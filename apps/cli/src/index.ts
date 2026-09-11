#!/usr/bin/env node
import { main } from "./cli.js";
import { isDebug } from "./debug.js";
import { colors } from "./ui/terminal.js";

main().catch((err: any) => {
  console.error(`\n ${colors.red}GitWhisper encountered an error:${colors.reset}\n`);
  console.error(` ${err.message || err}\n`);

  if (isDebug() && err.stack) {
    console.error(`${colors.dim + err.stack + colors.reset}\n`);
  }

  process.exit(1);
});
