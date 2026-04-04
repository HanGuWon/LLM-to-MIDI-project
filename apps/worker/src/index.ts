#!/usr/bin/env node

import { runWorker } from "./worker.js";

const result = await runWorker();
process.exitCode = result.exitCode;
