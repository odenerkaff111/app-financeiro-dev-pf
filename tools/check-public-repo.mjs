import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const ignoredDirectories = new Set([
  ".git",
  ".next",
  "node_modules",
  "dist",
  "coverage",
]);

const ignoredFiles = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

const forbiddenNames = [
  /^\.env(?:\..+)?$/i,
  /\.pem$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /production.*\.sql$/i,
  /dump.*\.sql$/i,
];

const contentChecks = [
  {
    label: "Chave OpenRouter",
    pattern: /sk-or-v1-[A-Za-z0-9_-]{20,}/g,
  },
  {
    label: "Variável secreta preenchida",
    pattern:
      /(?:OPENROUTER_API_KEY|SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY|SECURITY_LOG_SALT)\s*=\s*[^\s"']{8,}/g,
  },
  {
    label: "Possível CPF",
    pattern: /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g,
  },
  {
    label: "Seed possivelmente pessoal",
    pattern: /personal:[a-z0-9_-]+/gi,
  },
];

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
      return [];
    }

    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return walk(fullPath);
    }

    return [fullPath];
  });
}

const findings = [];

for (const filePath of walk(root)) {
  const relativePath = path.relative(root, filePath).replaceAll("\\", "/");
  const baseName = path.basename(filePath);

  if (ignoredFiles.has(baseName)) continue;

  for (const pattern of forbiddenNames) {
    if (pattern.test(baseName)) {
      findings.push({
        file: relativePath,
        issue: "Arquivo sensível não deve estar no repositório público",
      });
    }
  }

  const stat = fs.statSync(filePath);
  if (stat.size > 2_000_000) continue;

  const extension = path.extname(filePath).toLowerCase();
  if (
    ![
      ".ts",
      ".tsx",
      ".js",
      ".mjs",
      ".json",
      ".md",
      ".sql",
      ".yml",
      ".yaml",
      ".txt",
    ].includes(extension)
  ) {
    continue;
  }

  const content = fs.readFileSync(filePath, "utf8");

  for (const check of contentChecks) {
    check.pattern.lastIndex = 0;
    if (check.pattern.test(content)) {
      findings.push({
        file: relativePath,
        issue: check.label,
      });
    }
  }
}

if (findings.length > 0) {
  console.error("\nRepositório ainda não está pronto para exposição pública:\n");
  for (const finding of findings) {
    console.error(`- ${finding.file}: ${finding.issue}`);
  }
  console.error(
    "\nRemova os dados do estado atual e também do histórico Git antes de divulgar o repositório.\n",
  );
  process.exit(1);
}

console.log("Verificação pública concluída sem achados automáticos.");
