import { createWriteStream, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { formatWithOptions } from "node:util";

let initialized = false;
const DEFAULT_LOG_TRUNCATION_LENGTH = 400;

export function truncateLoggedText(
  value: string,
  maxLength = DEFAULT_LOG_TRUNCATION_LENGTH,
) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}...`;
}

function formatLogArgs(args: unknown[], colors: boolean) {
  return formatWithOptions(
    {
      colors,
      depth: null,
      maxArrayLength: null,
      maxStringLength: null,
      compact: false,
      breakLength: 120,
    },
    ...args,
  );
}

export function initRunLogging(logFilePath = "logs.txt") {
  if (initialized) {
    return resolve(process.cwd(), logFilePath);
  }

  const absoluteLogPath = resolve(process.cwd(), logFilePath);
  mkdirSync(dirname(absoluteLogPath), { recursive: true });

  const stream = createWriteStream(absoluteLogPath, { flags: "w" });
  const originalWrite = {
    stdout: process.stdout.write.bind(process.stdout),
    stderr: process.stderr.write.bind(process.stderr),
  };

  const wrapConsoleMethod =
    (target: "stdout" | "stderr") =>
    (...args: unknown[]) => {
      const streamIsTTY = target === "stdout" ? process.stdout.isTTY : process.stderr.isTTY;
      const shouldColorize = process.env.FORCE_COLOR === "0" ? false : Boolean(process.env.FORCE_COLOR) || streamIsTTY;
      const terminalOutput = `${formatLogArgs(args, shouldColorize)}\n`;
      const logOutput = `${formatLogArgs(args, false)}\n`;
      stream.write(logOutput);
      originalWrite[target](terminalOutput);
    };

  console.log = wrapConsoleMethod("stdout");
  console.info = wrapConsoleMethod("stdout");
  console.warn = wrapConsoleMethod("stderr");
  console.error = wrapConsoleMethod("stderr");
  console.debug = wrapConsoleMethod("stdout");

  process.on("exit", () => {
    stream.end();
  });

  initialized = true;
  console.log("Run logging initialized:", { logFilePath: absoluteLogPath });

  return absoluteLogPath;
}
