import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type {
  StatementPreview,
  StatementPreviewRow,
} from "@/lib/financial-actions";

type CategoryRow = {
  id: string;
  name: string;
  kind: string;
};

type ParsedRow = {
  externalId: string | null;
  date: string;
  description: string;
  signedAmount: number;
};

function tokenFrom(request: Request) {
  const value = request.headers.get("authorization");

  return value?.startsWith("Bearer ")
    ? value.slice(7).trim()
    : null;
}

function authorizedClient(accessToken: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )?.trim();

  if (!url || !key) {
    throw new Error("Supabase não configurado.");
  }

  return createClient(url, key, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDate(value: string) {
  const clean = value.trim();

  const isoMatch = clean.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);

  if (isoMatch) {
    const [, year, month, day] = isoMatch;

    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  const brazilMatch = clean.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);

  if (brazilMatch) {
    const [, day, month, rawYear] = brazilMatch;
    const year = rawYear.length === 2 ? `20${rawYear}` : rawYear;

    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  const ofxMatch = clean.match(/^(\d{4})(\d{2})(\d{2})/);

  if (ofxMatch) {
    const [, year, month, day] = ofxMatch;

    return `${year}-${month}-${day}`;
  }

  throw new Error(`Data não reconhecida: ${value}`);
}

function parseMoney(value: string) {
  const clean = value
    .replace(/R\$/gi, "")
    .replace(/\s/g, "")
    .trim();

  if (!clean) {
    return 0;
  }

  let normalized = clean;

  if (clean.includes(",") && clean.includes(".")) {
    normalized = clean.replace(/\./g, "").replace(",", ".");
  } else if (clean.includes(",")) {
    normalized = clean.replace(",", ".");
  }

  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : 0;
}

function fieldFromOfx(block: string, field: string) {
  const match = block.match(
    new RegExp(`<${field}>([^<\\r\\n]+)`, "i"),
  );

  return match?.[1]?.trim() ?? null;
}

function parseOfx(content: string) {
  const blocks = content.match(/<STMTTRN>[\s\S]*?(?=<STMTTRN>|<\/BANKTRANLIST>|<\/CCSTMTTRNRS>|$)/gi) ?? [];

  return blocks
    .map((block): ParsedRow | null => {
      const amountValue = fieldFromOfx(block, "TRNAMT");
      const dateValue = fieldFromOfx(block, "DTPOSTED");

      if (!amountValue || !dateValue) {
        return null;
      }

      const signedAmount = parseMoney(amountValue);

      if (!signedAmount) {
        return null;
      }

      const name = fieldFromOfx(block, "NAME");
      const memo = fieldFromOfx(block, "MEMO");
      const checkNumber = fieldFromOfx(block, "CHECKNUM");

      return {
        externalId: fieldFromOfx(block, "FITID"),
        date: normalizeDate(dateValue),
        description:
          [name, memo, checkNumber]
            .filter(Boolean)
            .join(" - ") || "Movimentação importada",
        signedAmount,
      };
    })
    .filter((row): row is ParsedRow => Boolean(row));
}

function detectDelimiter(firstLine: string) {
  const candidates = [";", ",", "\t"];

  return candidates.sort(
    (first, second) =>
      firstLine.split(second).length - firstLine.split(first).length,
  )[0];
}

function parseCsvLine(line: string, delimiter: string) {
  const values: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (character === '"') {
      const nextCharacter = line[index + 1];

      if (quoted && nextCharacter === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }

      continue;
    }

    if (character === delimiter && !quoted) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += character;
  }

  values.push(current.trim());

  return values;
}

function findHeaderIndex(headers: string[], aliases: string[]) {
  return headers.findIndex((header) =>
    aliases.some((alias) => header === alias || header.includes(alias)),
  );
}

function parseCsv(content: string) {
  const lines = content
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim());

  if (lines.length < 2) {
    throw new Error("O CSV não possui movimentações.");
  }

  const delimiter = detectDelimiter(lines[0]);
  const rawHeaders = parseCsvLine(lines[0], delimiter);
  const headers = rawHeaders.map(normalizeText);

  const dateIndex = findHeaderIndex(headers, [
    "data lancamento",
    "data movimento",
    "data",
    "date",
  ]);

  const descriptionIndex = findHeaderIndex(headers, [
    "descricao",
    "historico",
    "lancamento",
    "memo",
    "title",
    "estabelecimento",
  ]);

  const amountIndex = findHeaderIndex(headers, [
    "valor lancamento",
    "valor",
    "amount",
  ]);

  const creditIndex = findHeaderIndex(headers, [
    "credito",
    "entrada",
    "credit",
  ]);

  const debitIndex = findHeaderIndex(headers, [
    "debito",
    "saida",
    "debit",
  ]);

  const idIndex = findHeaderIndex(headers, [
    "identificador",
    "documento",
    "fitid",
    "id",
  ]);

  if (dateIndex < 0 || descriptionIndex < 0) {
    throw new Error(
      "Não encontrei as colunas de data e descrição no CSV.",
    );
  }

  if (amountIndex < 0 && creditIndex < 0 && debitIndex < 0) {
    throw new Error("Não encontrei uma coluna de valor no CSV.");
  }

  return lines
    .slice(1)
    .map((line): ParsedRow | null => {
      const values = parseCsvLine(line, delimiter);
      const dateValue = values[dateIndex]?.trim();
      const description = values[descriptionIndex]?.trim();

      if (!dateValue || !description) {
        return null;
      }

      let signedAmount = 0;

      if (amountIndex >= 0) {
        signedAmount = parseMoney(values[amountIndex] ?? "");
      } else {
        const credit =
          creditIndex >= 0
            ? Math.abs(parseMoney(values[creditIndex] ?? ""))
            : 0;
        const debit =
          debitIndex >= 0
            ? Math.abs(parseMoney(values[debitIndex] ?? ""))
            : 0;

        signedAmount = credit > 0 ? credit : -debit;
      }

      if (!signedAmount) {
        return null;
      }

      return {
        externalId:
          idIndex >= 0 && values[idIndex]
            ? values[idIndex].trim()
            : null,
        date: normalizeDate(dateValue),
        description,
        signedAmount,
      };
    })
    .filter((row): row is ParsedRow => Boolean(row));
}

function findCategory(
  description: string,
  type: "income" | "expense",
  categories: CategoryRow[],
) {
  const normalized = normalizeText(description);

  const mappings: Array<{
    keywords: string[];
    names: string[];
  }> = [
    {
      keywords: [
        "supermercado",
        "mercado",
        "atacadao",
        "supernosso",
        "verdemar",
        "restaurante",
        "ifood",
        "padaria",
      ],
      names: ["alimentacao", "compras"],
    },
    {
      keywords: ["escola", "ipe", "curso", "judo", "faculdade"],
      names: ["educacao"],
    },
    {
      keywords: ["farmacia", "academia", "medico", "dentista", "hospital"],
      names: ["saude"],
    },
    {
      keywords: ["uber", "99app", "combustivel", "posto", "estacionamento"],
      names: ["transporte"],
    },
    {
      keywords: ["cemig", "copasa", "internet", "vanete", "aluguel"],
      names: ["contas da casa", "moradia"],
    },
    {
      keywords: ["disney", "netflix", "spotify", "cinema", "streaming"],
      names: ["diversao", "entretenimento"],
    },
    {
      keywords: ["salario", "power of data", "pagamento recebido"],
      names: ["salario", "renda"],
    },
  ];

  const categoryCandidates = categories.filter((category) => {
    if (type === "income") {
      return category.kind === "income";
    }

    return category.kind === "expense" || category.kind === "debt";
  });

  for (const mapping of mappings) {
    if (!mapping.keywords.some((keyword) => normalized.includes(keyword))) {
      continue;
    }

    const found = categoryCandidates.find((category) => {
      const categoryName = normalizeText(category.name);

      return mapping.names.some((name) => categoryName.includes(name));
    });

    if (found) {
      return found;
    }
  }

  return null;
}

function fingerprintFor(
  accountId: string,
  row: ParsedRow,
) {
  return createHash("sha256")
    .update(
      [
        accountId,
        row.date,
        row.signedAmount.toFixed(2),
        row.externalId ?? "",
        normalizeText(row.description),
      ].join("|"),
    )
    .digest("hex");
}

export async function POST(request: Request) {
  try {
    const accessToken = tokenFrom(request);

    if (!accessToken) {
      return NextResponse.json(
        { error: "Sessão não informada." },
        { status: 401 },
      );
    }

    const supabase = authorizedClient(accessToken);
    const { data: userData, error: userError } =
      await supabase.auth.getUser();

    if (userError || !userData.user) {
      return NextResponse.json(
        { error: "Sua sessão expirou." },
        { status: 401 },
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");
    const householdId = String(formData.get("householdId") ?? "").trim();
    const accountId = String(formData.get("accountId") ?? "").trim();

    if (!(file instanceof File)) {
      throw new Error("Selecione um arquivo OFX ou CSV.");
    }

    if (!householdId || !accountId) {
      throw new Error("Selecione a conta do extrato.");
    }

    if (file.size > 8 * 1024 * 1024) {
      throw new Error("O arquivo deve ter no máximo 8 MB.");
    }

    const membershipResult = await supabase
      .from("pf_household_members")
      .select("household_id")
      .eq("household_id", householdId)
      .eq("user_id", userData.user.id)
      .maybeSingle();

    if (membershipResult.error || !membershipResult.data) {
      throw new Error("Você não possui acesso a este grupo familiar.");
    }

    const [accountResult, categoriesResult] = await Promise.all([
      supabase
        .from("pf_accounts")
        .select("id, name")
        .eq("id", accountId)
        .eq("household_id", householdId)
        .eq("is_active", true)
        .maybeSingle(),
      supabase
        .from("pf_categories")
        .select("id, name, kind")
        .eq("household_id", householdId),
    ]);

    if (accountResult.error || !accountResult.data) {
      throw new Error("A conta selecionada não foi encontrada.");
    }

    if (categoriesResult.error) {
      throw categoriesResult.error;
    }

    const fileName = file.name;
    const extension = fileName.split(".").pop()?.toLowerCase();
    const content = Buffer.from(await file.arrayBuffer()).toString("utf8");

    let parsedRows: ParsedRow[];

    if (extension === "ofx") {
      parsedRows = parseOfx(content);
    } else if (extension === "csv") {
      parsedRows = parseCsv(content);
    } else {
      throw new Error("Formato não suportado. Use OFX ou CSV.");
    }

    parsedRows = parsedRows.slice(0, 500);

    if (parsedRows.length === 0) {
      throw new Error("Nenhuma movimentação válida foi encontrada.");
    }

    const firstDate = parsedRows.reduce(
      (smallest, row) => (row.date < smallest ? row.date : smallest),
      parsedRows[0].date,
    );
    const lastDate = parsedRows.reduce(
      (largest, row) => (row.date > largest ? row.date : largest),
      parsedRows[0].date,
    );

    const existingResult = await supabase
      .from("pf_transactions")
      .select("metadata")
      .eq("household_id", householdId)
      .eq("account_id", accountId)
      .gte("occurred_on", firstDate)
      .lte("occurred_on", lastDate)
      .eq("source", "import");

    if (existingResult.error) {
      throw existingResult.error;
    }

    const existingFingerprints = new Set(
      (existingResult.data ?? [])
        .map((item) => {
          const metadata = item.metadata as Record<string, unknown> | null;

          return typeof metadata?.import_fingerprint === "string"
            ? metadata.import_fingerprint
            : null;
        })
        .filter((value): value is string => Boolean(value)),
    );

    const categories = (categoriesResult.data ?? []) as CategoryRow[];

    const rows: StatementPreviewRow[] = parsedRows.map((row) => {
      const fingerprint = fingerprintFor(accountId, row);
      const type = row.signedAmount >= 0 ? "income" : "expense";
      const category = findCategory(row.description, type, categories);

      return {
        fingerprint,
        external_id: row.externalId,
        occurred_on: row.date,
        description: row.description,
        amount: Math.abs(row.signedAmount),
        signed_amount: row.signedAmount,
        type,
        category_id: category?.id ?? null,
        category_name: category?.name ?? null,
        duplicate: existingFingerprints.has(fingerprint),
      };
    });

    const newRows = rows.filter((row) => !row.duplicate);

    const preview: StatementPreview = {
      file_name: fileName,
      account_id: accountId,
      account_name: String(accountResult.data.name),
      rows,
      total_rows: rows.length,
      new_rows: newRows.length,
      duplicate_rows: rows.length - newRows.length,
      total_income: newRows
        .filter((row) => row.type === "income")
        .reduce((total, row) => total + row.amount, 0),
      total_expense: newRows
        .filter((row) => row.type === "expense")
        .reduce((total, row) => total + row.amount, 0),
    };

    return NextResponse.json(preview);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível analisar o extrato.",
      },
      { status: 400 },
    );
  }
}
