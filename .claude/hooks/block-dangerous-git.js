#!/usr/bin/env node
let input = "";
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  let command = "";
  try {
    command = JSON.parse(input)?.tool_input?.command ?? "";
  } catch {}

  const DANGEROUS_PATTERNS = [
    /git\s+push/,
    /git\s+reset\s+--hard/,
    /git\s+clean\s+-f/,
    /git\s+branch\s+-D/,
    /git\s+checkout\s+\./,
    /git\s+restore\s+\./,
    /push\s+--force/,
    /push\s+-f\s/,
    /reset\s+--hard/,
  ];

  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      console.error(
        `BLOCKED: '${command}' matches dangerous pattern '${pattern}'. Git Policy 'Local-First, Ask-to-Exit' (xem AGENTS.md): user phải tự push tay hoặc duyệt tường minh từng lần.`
      );
      process.exit(2);
    }
  }
  process.exit(0);
});
