# dsh-customs-mcp

A read-only MCP server that checks a Chinese customs declaration ledger for internal inconsistency.

It takes the ledger a declarant already keeps — one row per document line — and reports where the rows disagree with each other or with the pack's declared format checks: an HS code that is not ten digits, a currency that is not a three-letter code, gross weight below net weight, a document number used twice, a date that does not parse, an unfilled placeholder.

It does not decide whether a declaration is correct, whether goods are misclassified, or whether duty is owed.

## Install

```bash
npx -y dsh-customs-mcp
```

Or in a client config:

```json
{
  "mcpServers": {
    "customs": {
      "command": "npx",
      "args": ["-y", "dsh-customs-mcp"]
    }
  }
}
```

No dependencies, no credentials, no network. Node ≥ 18.

## Tools

| Tool | Purpose |
|---|---|
| `customs_check` | Run the rule pack over a JSON/YAML ledger and return a Markdown report. |
| `customs_read_docx` | Extract text from a `.docx` so it can become a ledger. |
| `customs_schema` | The column contract and every accepted alias. |
| `customs_rulebook` | The rules, their basis kinds, and how many carry a verbatim clause. |

## The honest part

Every rule in the pack states what it rests on, and **0 of the 7 currently hold the verbatim clause text**. The pack says so itself: each such rule's excerpt reads "该条文本次未取得" (the clause text was not obtained this time) rather than paraphrasing a regulation the author could not read.

`customs_rulebook` reports that coverage as a computed number, not as a claim:

```json
"coverage": {
  "rules": 7,
  "verbatimClause": 0,
  "uncited": 7,
  "bySeverity": { "warn": 7 },
  "byBasisKind": { "derived-from-principle": 7 }
}
```

So the checks are format and arithmetic consistency, capped at `warn`, and the report says which of them did not run at all. That is a weaker claim than a compliance tool usually makes, and it is the one this server can support.

## Example

```json
{
  "declarationNo": "530120260000123456",
  "rows": [
    { "单证编号": "INV-2026-001", "商品编号": "84713000", "品名": "笔记本电脑",
      "总价": "50000", "币制": "USD", "毛重": "10", "净重": "12", "申报日期": "2026-02-31" }
  ]
}
```

```
- **[提示] CD-002** — 第1行数据
  - 实际：第 1 行「hsCode」的值「84713000」不符合配置的形式
- **[提示] CD-005** — 第1行数据
  - 实际：第 1 行「grossWeight」为 10，「netWeight」为 12，不满足不小于关系
- **[提示] CD-006** — 第1行数据
  - 实际：第 1 行「declaredAt」的值「2026-02-31」无法解析为日期
```

## Scope

- Table-driven only: the input is a ledger you already have, in JSON or YAML.
- `.docx` is supported through `customs_read_docx`. `.doc`/`.wps` are a different binary format, and PDF is refused on purpose — a PDF table loses its cell structure, and reconstructing it yields a ledger that is wrong in ways the check cannot catch.
- The engine, the rule pack and the table spec are compiled into `src/check.mjs` so the package installs nothing at runtime.
- Read-only: it reads the one `.docx` path you pass, opens it read-only, and refuses anything over 20 MB. No network, no writes, no credentials.

## License

Apache-2.0.
