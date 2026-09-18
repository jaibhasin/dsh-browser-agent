import { resolve } from "node:path";
import { renderReportDirectory } from "../evals/memory-benchmark/memory-chart.mjs";

const directory = process.argv[2];
if (!directory) {
  console.error("Usage: pnpm report:memory <memory-reports/run-directory>");
  process.exit(1);
}
try {
  renderReportDirectory(resolve(directory));
  console.log(`Report charts written to ${resolve(directory)}`);
} catch (error) {
  console.error(`Could not render report: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
