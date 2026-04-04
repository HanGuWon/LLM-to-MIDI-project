#!/usr/bin/env node

import { parseWorkerArgs, runWorker } from "./worker.js";

const result = await runWorker(parseWorkerArgs(process.argv.slice(2)));
process.exitCode = result.exitCode;
