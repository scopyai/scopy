import { createWriteStream, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { formatWithOptions } from "node:util";

let initialized = false;
const MAX_LOG_STRING_LENGTH = 200;

function truncateString(value: string) {
  if (value.length <= MAX_LOG_STRING_LENGTH) {
    return value;
  }

  return `${value.slice(0, MAX_LOG_STRING_LENGTH)}... [truncated ${value.length - MAX_LOG_STRING_LENGTH} chars]`;
}

function truncateValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") {
    return truncateString(value);
  }

  if (
    value === null ||
    value === undefined ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return value;
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: truncateString(value.message),
      stack: value.stack ? truncateString(value.stack) : undefined,
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => truncateValue(item, seen));
  }

  if (typeof value === "object") {
    if (seen.has(value)) {
      return "[Circular]";
    }

    seen.add(value);

    const entries = Object.entries(value as Record<string, unknown>).map(
      ([key, item]) => [key, truncateValue(item, seen)],
    );

    return Object.fromEntries(entries);
  }

  return String(value);
}

function formatLogArgs(args: unknown[]) {
  return formatWithOptions(
    {
      colors: false,
      depth: null,
      maxArrayLength: null,
      maxStringLength: null,
      compact: false,
      breakLength: 120,
    },
    ...args.map((arg) => truncateValue(arg)),
  );
}

export function initRunLogging(logFilePath = "logs.txt") {
  if (initialized) {
    return resolve(process.cwd(), logFilePath);
  }

  const absoluteLogPath = resolve(process.cwd(), logFilePath);
  mkdirSync(dirname(absoluteLogPath), { recursive: true });

  const stream = createWriteStream(absoluteLogPath, { flags: "w" });
  const originalConsole = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console),
  };

  const wrapConsoleMethod =
    (methodName: keyof typeof originalConsole) =>
    (...args: unknown[]) => {
      stream.write(`${formatLogArgs(args)}\n`);
      originalConsole[methodName](...args);
    };

  console.log = wrapConsoleMethod("log");
  console.info = wrapConsoleMethod("info");
  console.warn = wrapConsoleMethod("warn");
  console.error = wrapConsoleMethod("error");
  console.debug = wrapConsoleMethod("debug");

  process.on("exit", () => {
    stream.end();
  });

  initialized = true;
  console.log("Run logging initialized:", { logFilePath: absoluteLogPath });

  return absoluteLogPath;
}
