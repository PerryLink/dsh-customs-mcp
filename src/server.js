// Pure JSON-RPC core for dsh-customs-mcp. No transport, no network, no writes.
//
// The engine is compiled in (src/check.mjs) for the same reason the skill bundles
// it: `npx` has to work in a host with nothing else installed. The rule pack was
// validated by loadRuleset() at build time, so an excerpt that is not verbatim
// cannot reach here.
//
// The server's honesty contract is the same one the checkers are built on: it
// reports differences between a ledger and the pack's declared checks, it never
// states a conclusion about the goods, and when the pack cannot quote a clause it
// says so instead of paraphrasing one.

import { readFile } from 'node:fs/promises'
import { check, COLUMN_CONTRACT, rulebook, renderMarkdown } from './check.mjs'
import { docxToText } from './docx.mjs'

const PACKAGE = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

const PROTOCOL_VERSION = '2024-11-05'
const SERVER_INFO = { name: 'dsh-customs-mcp', version: PACKAGE.version }

const MAX_DOCX_BYTES = 20 * 1024 * 1024

const ANNOTATIONS_READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
}

const SCHEMA_TEXT = JSON.stringify(COLUMN_CONTRACT, null, 2)

const TOOLS = [
  {
    name: 'customs_check',
    title: 'Check a declaration ledger for internal inconsistency',
    description:
      'Run the customs declaration rule pack over a declaration ledger and return the findings as a Markdown report. ' +
      'The input is a JSON or YAML table: one row per document line, with columns such as 品名 (description), 商品编号 (HS code), 币制 (currency), 毛重/净重 (gross/net weight), 申报日期 (declaration date) and 总价 (total value). Call customs_schema for the exact field names and their aliases. ' +
      'The report lists only literal differences from the declared checks — an HS code that is not ten digits, a currency that is not a 3-letter code, gross weight below net weight, a duplicated document number, a date that does not parse or is in the future, an unfilled placeholder. Each finding carries the clause it rests on, or states that the clause text was not obtained. ' +
      'It does NOT decide whether a declaration is correct, whether goods are misclassified, or whether duty is owed. It performs no writes and needs no credentials. ' +
      'Read the "未执行的检查" (checks not executed) section at the end: it names every rule that did not run and why, and a report is only as complete as that list allows.',
    annotations: ANNOTATIONS_READ_ONLY,
    inputSchema: {
      type: 'object',
      properties: {
        material: {
          type: 'string',
          description:
            'The ledger as JSON or YAML text. Either an object with a `rows` array, or a bare array of row objects.',
        },
        onlyRules: {
          type: 'array',
          items: { type: 'string' },
          description: 'Run only these rule ids, e.g. ["CD-002"]. Omit to run the whole pack.',
        },
      },
      required: ['material'],
    },
  },
  {
    name: 'customs_read_docx',
    title: 'Extract readable text from a .docx',
    description:
      'Extract text from a .docx file so it can be turned into a ledger for customs_check. Paragraphs come out one per line; table rows come out as "| a | b | c |" lines. ' +
      'Merged cells are marked "↔", meaning "this cell is merged with the one to its left and holds no value of its own" — do not read it as a missing value. A vertically merged cell repeats the value above it, which is what a reader of the document sees. ' +
      'Reads exactly the one path given, opens it read-only, and refuses anything larger than 20 MB. No other file is touched, no network is used, nothing is written. ' +
      'Only a path ending in .docx is accepted: legacy .doc/.wps are a different binary format and PDF is not parsed on purpose — a PDF table loses its cell structure, and guessing it produces a ledger that is wrong in ways the check cannot detect.',
    annotations: ANNOTATIONS_READ_ONLY,
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Absolute or working-directory-relative path to the .docx file.',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'customs_schema',
    title: 'Show the ledger column contract',
    description:
      'Return the column contract for customs_check: the accepted field names, every alias each field answers to (for example 品名 / goodsName, 币制 / currency), and the header-level fields. ' +
      'Call this first when assembling a ledger, because a column name the reader does not recognise is silently dropped and the corresponding rule then reports nothing. ' +
      'Read-only, no parameters, no network, no writes.',
    annotations: ANNOTATIONS_READ_ONLY,
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'customs_rulebook',
    title: 'List the rules and how many can quote their source',
    description:
      'Return every rule in the pack: id, title, severity, the basis kind (direct clause / derived from principle / local configuration), the document and clause it cites, and whether the pack actually holds the verbatim clause text. ' +
      'The `coverage` object states how many rules carry a verbatim clause and how many record that the clause was not obtained, so a reader can weigh the report instead of trusting it. ' +
      'This is the answer to "how much of this is actually backed by a quoted regulation" — the number is computed from the pack, not asserted. ' +
      'Read-only, no parameters, no network, no writes.',
    annotations: ANNOTATIONS_READ_ONLY,
    inputSchema: { type: 'object', properties: {} },
  },
]

const textResult = (id, text, isError = false) => ({
  jsonrpc: '2.0',
  id,
  result: { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) },
})

const callTool = async (name, args) => {
  if (name === 'customs_schema') return SCHEMA_TEXT
  if (name === 'customs_rulebook') return JSON.stringify(rulebook(), null, 2)
  if (name === 'customs_check') {
    if (typeof args?.material !== 'string' || args.material.trim() === '') {
      throw new Error('material is required and must be non-empty JSON or YAML text')
    }
    const onlyRules = Array.isArray(args.onlyRules) ? args.onlyRules.map(String) : []
    const report = check(args.material, 'material', undefined, { onlyRules })
    return renderMarkdown(report)
  }
  if (name === 'customs_read_docx') {
    if (typeof args?.path !== 'string' || args.path.trim() === '') {
      throw new Error('path is required')
    }
    if (!args.path.toLowerCase().endsWith('.docx')) {
      throw new Error('only .docx is supported; convert .doc/.wps to .docx first, and do not use PDF')
    }
    const buffer = await readFile(args.path)
    if (buffer.length > MAX_DOCX_BYTES) {
      throw new Error(`refusing a ${(buffer.length / 1024 / 1024).toFixed(1)} MB file; the limit is 20 MB`)
    }
    const text = docxToText(buffer)
    return text === '' ? '(the document body produced no text)' : text
  }
  throw new Error(`unknown tool: ${name}`)
}

export async function handleRequest(req) {
  switch (req.method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        },
      }
    case 'notifications/initialized':
      return null
    case 'ping':
      return { jsonrpc: '2.0', id: req.id, result: {} }
    case 'tools/list':
      return { jsonrpc: '2.0', id: req.id, result: { tools: TOOLS } }
    case 'tools/call': {
      const { name, arguments: args } = req.params ?? {}
      if (!TOOLS.some((tool) => tool.name === name)) {
        return { jsonrpc: '2.0', id: req.id, error: { code: -32602, message: `Unknown tool: ${name}` } }
      }
      try {
        return textResult(req.id, await callTool(name, args))
      } catch (error) {
        return textResult(req.id, `Error: ${error.message}`, true)
      }
    }
    default:
      return { jsonrpc: '2.0', id: req.id, error: { code: -32601, message: `Method not found: ${req.method}` } }
  }
}

export { SERVER_INFO, PROTOCOL_VERSION, TOOLS }
