// entry-customs.ts
import { readFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

// ../../mnt/d/Projects/dsh/checkers/dsh-customs-doc-check/src/shared/yaml.ts
var YamlSubsetError = class extends Error {
  constructor(message, line) {
    super(line === void 0 ? message : `${message} (line ${line})`);
    this.name = "YamlSubsetError";
  }
};
function stripComment(raw, lineNum) {
  let quote = null;
  for (let index = 0; index < raw.length; index++) {
    const char = raw[index];
    if (quote !== null) {
      if (quote === '"' && char === "\\") {
        index += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "#" && (index === 0 || /\s/.test(raw[index - 1]))) return raw.slice(0, index);
  }
  if (quote !== null) throw new YamlSubsetError("unterminated quoted scalar", lineNum);
  return raw;
}
function unescapeDouble(body, lineNum) {
  let out = "";
  for (let index = 0; index < body.length; index++) {
    const char = body[index];
    if (char !== "\\") {
      out += char;
      continue;
    }
    const next = body[index + 1];
    if (next === void 0) throw new YamlSubsetError("dangling escape in double-quoted scalar", lineNum);
    index += 1;
    switch (next) {
      case "n":
        out += "\n";
        break;
      case "t":
        out += "	";
        break;
      case "r":
        out += "\r";
        break;
      case '"':
        out += '"';
        break;
      case "\\":
        out += "\\";
        break;
      case "0":
        out += "\0";
        break;
      default:
        throw new YamlSubsetError(`unsupported escape "\\${next}"`, lineNum);
    }
  }
  return out;
}
function findKeySeparator(text) {
  let quote = null;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quote !== null) {
      if (quote === '"' && char === "\\") {
        index += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ":" && (index + 1 === text.length || /\s/.test(text[index + 1]))) return index;
  }
  return -1;
}
function isSequenceItem(text) {
  return text === "-" || text.startsWith("- ");
}
function parseScalar(raw, lineNum) {
  const text = raw.trim();
  if (text === "") return null;
  if (text.startsWith("[") || text.startsWith("{")) return parseFlow(text, lineNum);
  if (text.startsWith("&") || text.startsWith("*") || text.startsWith("!")) {
    throw new YamlSubsetError("anchors, aliases and tags are not supported by this reader", lineNum);
  }
  if (text.startsWith('"')) {
    if (text.length < 2 || !text.endsWith('"')) throw new YamlSubsetError("bad double-quoted scalar", lineNum);
    return unescapeDouble(text.slice(1, -1), lineNum);
  }
  if (text.startsWith("'")) {
    if (text.length < 2 || !text.endsWith("'")) throw new YamlSubsetError("bad single-quoted scalar", lineNum);
    return text.slice(1, -1).replace(/''/g, "'");
  }
  if (text === "null" || text === "~") return null;
  if (text === "true") return true;
  if (text === "false") return false;
  if (/^[+-]?\d+$/.test(text)) return Number.parseInt(text, 10);
  if (/^[+-]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?$/.test(text)) return Number.parseFloat(text);
  return text;
}
function parseFlow(text, lineNum) {
  let index = 0;
  const skipSpace = () => {
    while (index < text.length && /\s/.test(text[index])) index += 1;
  };
  const readToken = (stopAtColon) => {
    skipSpace();
    const char = text[index];
    if (char === void 0) throw new YamlSubsetError("unexpected end of flow collection", lineNum);
    if (char === "[" || char === "{") return readCollection();
    if (char === '"' || char === "'") {
      const quote = char;
      let body = "";
      index += 1;
      while (index < text.length) {
        const current = text[index];
        if (quote === '"' && current === "\\") {
          body += current + (text[index + 1] ?? "");
          index += 2;
          continue;
        }
        if (current === quote) {
          if (quote === "'" && text[index + 1] === "'") {
            body += "'";
            index += 2;
            continue;
          }
          index += 1;
          return quote === '"' ? unescapeDouble(body, lineNum) : body;
        }
        body += current;
        index += 1;
      }
      throw new YamlSubsetError("unterminated quoted scalar in flow collection", lineNum);
    }
    let plain = "";
    while (index < text.length) {
      const current = text[index];
      if (current === "," || current === "]" || current === "}") break;
      if (stopAtColon && current === ":") break;
      plain += current;
      index += 1;
    }
    return parseScalar(plain, lineNum);
  };
  const readCollection = () => {
    const open = text[index];
    const close = open === "[" ? "]" : "}";
    index += 1;
    if (open === "[") {
      const items = [];
      skipSpace();
      if (text[index] === close) {
        index += 1;
        return items;
      }
      for (; ; ) {
        items.push(readToken(false));
        skipSpace();
        const separator = text[index];
        if (separator === ",") {
          index += 1;
          continue;
        }
        if (separator === close) {
          index += 1;
          return items;
        }
        throw new YamlSubsetError(`expected "," or "${close}" in flow sequence`, lineNum);
      }
    }
    const out = {};
    skipSpace();
    if (text[index] === close) {
      index += 1;
      return out;
    }
    for (; ; ) {
      const key = readToken(true);
      skipSpace();
      if (text[index] !== ":") throw new YamlSubsetError('expected ":" in flow mapping', lineNum);
      index += 1;
      const value2 = readToken(false);
      out[String(key)] = value2;
      skipSpace();
      const separator = text[index];
      if (separator === ",") {
        index += 1;
        continue;
      }
      if (separator === close) {
        index += 1;
        return out;
      }
      throw new YamlSubsetError(`expected "," or "${close}" in flow mapping`, lineNum);
    }
  };
  const value = readCollection();
  skipSpace();
  if (index !== text.length) {
    throw new YamlSubsetError(`trailing characters after flow collection: "${text.slice(index)}"`, lineNum);
  }
  return value;
}
var Reader = class {
  index = 0;
  /** Content lines, in document order. */
  lines;
  constructor(lines) {
    this.lines = lines;
  }
  /** Current line, or undefined at end of document. */
  peek() {
    return this.lines[this.index];
  }
  /** Consume and return the current line. */
  take() {
    const line = this.lines[this.index];
    if (line === void 0) throw new YamlSubsetError("unexpected end of document");
    this.index += 1;
    return line;
  }
  /** Body of a `|` or `>` block scalar, stopping at the first line at or above `parentIndent`. */
  readBlockScalar(parentIndent, kind, startLine) {
    const collected = [];
    let blockIndent = null;
    while (true) {
      const next = this.peek();
      if (next === void 0 || next.indent <= parentIndent) break;
      this.index += 1;
      if (blockIndent === null) blockIndent = next.indent;
      collected.push(" ".repeat(Math.max(0, next.indent - blockIndent)) + next.text);
    }
    if (blockIndent === null) throw new YamlSubsetError("empty block scalar", startLine);
    if (kind === "|") return collected.join("\n");
    return collected.map((entry) => entry.trim()).filter((entry) => entry !== "").join(" ");
  }
  /**
   * Read the value of `key:` whose scalar part was empty.
   * @param keyIndent - column of the key, so a shallower sibling ends the value.
   */
  readNested(keyIndent) {
    const next = this.peek();
    if (next === void 0 || next.indent <= keyIndent) return null;
    return this.readCollection(next.indent);
  }
  /**
   * Read a mapping or sequence starting at the current line.
   * @param indent - column at which the collection's entries must start.
   */
  readCollection(indent) {
    const line = this.peek();
    if (line === void 0 || line.indent < indent) return null;
    return isSequenceItem(line.text) ? this.readSequence(line.indent) : this.readMapping(line.indent);
  }
  /**
   * Read a block mapping whose entries sit at `indent`.
   * @param indent - column the mapping entries occupy.
   * @param seed - first entry that shares a `- ` line and was already consumed.
   */
  readMapping(indent, seed) {
    const out = {};
    let pending = seed;
    for (; ; ) {
      if (pending === void 0) {
        const line = this.peek();
        if (line === void 0 || line.indent < indent) break;
        if (line.indent > indent) throw new YamlSubsetError("unexpected indentation in block mapping", line.num);
        if (isSequenceItem(line.text)) break;
        this.index += 1;
        pending = { text: line.text, line: line.num };
      }
      const separator = findKeySeparator(pending.text);
      if (separator < 0) throw new YamlSubsetError(`expected "key: value", got "${pending.text}"`, pending.line);
      const key = pending.text.slice(0, separator).trim();
      if (key === "") throw new YamlSubsetError("empty mapping key", pending.line);
      if (Object.hasOwn(out, key)) throw new YamlSubsetError(`duplicate mapping key "${key}"`, pending.line);
      out[key] = this.readEntryValue(pending.text.slice(separator + 1).trim(), indent, pending.line);
      pending = void 0;
    }
    return out;
  }
  /** Value that follows `key:` on the same line, or the nested collection below it. */
  readEntryValue(rawValue, keyIndent, lineNum) {
    if (rawValue === "|" || rawValue === "|-" || rawValue === ">" || rawValue === ">-") {
      return this.readBlockScalar(keyIndent, rawValue.startsWith("|") ? "|" : ">", lineNum);
    }
    if (rawValue !== "") return parseScalar(rawValue, lineNum);
    return this.readNested(keyIndent);
  }
  /**
   * Read a block sequence whose dashes sit at `indent`. A `- key: value` line
   * opens a mapping whose first entry shares the dash line; the remaining entries
   * follow at the key column, which is two past the dash.
   */
  readSequence(indent) {
    const items = [];
    for (; ; ) {
      const line = this.peek();
      if (line === void 0 || line.indent < indent) break;
      if (line.indent > indent) throw new YamlSubsetError("unexpected indentation in block sequence", line.num);
      if (!isSequenceItem(line.text)) break;
      this.index += 1;
      const rest = line.text === "-" ? "" : line.text.slice(2).trim();
      const separator = rest === "" ? -1 : findKeySeparator(rest);
      if (separator >= 0) {
        items.push(this.readMapping(indent + 2, { text: rest, line: line.num }));
        continue;
      }
      items.push(rest === "" ? this.readNested(indent) : parseScalar(rest, line.num));
    }
    return items;
  }
};
function tokenize(source) {
  const rawLines = source.split(/\r?\n/);
  const lines = [];
  let blockIndent = null;
  let blockParentIndent = -1;
  for (let index = 0; index < rawLines.length; index++) {
    const num = index + 1;
    const raw = rawLines[index];
    const expanded = raw.replace(/\t/g, "  ");
    const indent = expanded.length - expanded.trimStart().length;
    const body = expanded.trim();
    if (blockIndent !== null) {
      if (body === "") continue;
      if (indent <= blockParentIndent) {
        blockIndent = null;
      } else {
        lines.push({ indent, text: body, num });
        continue;
      }
    }
    const withoutComment = stripComment(raw, num);
    if (withoutComment.trim() === "") continue;
    const text = withoutComment.replace(/\t/g, "  ").trim();
    const effectiveIndent = withoutComment.replace(/\t/g, "  ").length - withoutComment.replace(/\t/g, "  ").trimStart().length;
    lines.push({ indent: effectiveIndent, text, num });
    if (/:\s*[|>][+-]?\s*$/.test(text)) {
      blockIndent = effectiveIndent + 1;
      blockParentIndent = effectiveIndent;
    }
  }
  return lines;
}
function parseYaml(source) {
  const lines = tokenize(source);
  if (lines.length === 0) return null;
  const reader = new Reader(lines);
  const value = reader.readCollection(lines[0].indent);
  const leftover = reader.peek();
  if (leftover !== void 0) throw new YamlSubsetError("trailing content after document", leftover.num);
  return value;
}
function requireString(source, key, where) {
  const value = source[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new YamlSubsetError(`${where}: missing required string field "${key}"`);
  }
  return value;
}

// ../../mnt/d/Projects/dsh/checkers/dsh-customs-doc-check/src/shared/table.ts
var MaterialError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "MaterialError";
  }
};
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function cellText(value) {
  if (value === void 0 || value === null) return void 0;
  if (typeof value === "string") return value.trim() === "" ? void 0 : value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return String(value);
  return void 0;
}
function normaliseName(value) {
  return value.toLowerCase().replace(/[\s\u3000_-]/g, "");
}
function pick(fields, aliases) {
  for (const alias of aliases) {
    const direct = fields[alias];
    if (direct !== void 0 && direct !== "") return direct;
  }
  const normalised = new Map(Object.keys(fields).map((key) => [normaliseName(key), key]));
  for (const alias of aliases) {
    const key = normalised.get(normaliseName(alias));
    if (key === void 0) continue;
    const value = fields[key];
    if (value !== void 0 && value !== "") return value;
  }
  return void 0;
}
function parseTable(source, target, spec) {
  const trimmed = source.trim();
  if (trimmed === "") throw new MaterialError("\u6750\u6599\u4E3A\u7A7A");
  let document;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      document = JSON.parse(trimmed);
    } catch (error) {
      throw new MaterialError(`JSON \u65E0\u6CD5\u89E3\u6790\uFF1A${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    try {
      document = parseYaml(trimmed);
    } catch (error) {
      if (error instanceof YamlSubsetError) throw new MaterialError(`YAML \u65E0\u6CD5\u89E3\u6790\uFF1A${error.message}`);
      throw error;
    }
  }
  const warnings = [];
  let list;
  const header = {};
  let topLevel = {};
  if (Array.isArray(document)) {
    list = document;
  } else if (isRecord(document)) {
    topLevel = document;
    for (const key of spec.rowKeys) {
      const candidate = document[key];
      if (candidate !== void 0 && candidate !== null) {
        list = candidate;
        break;
      }
    }
    const scalars = {};
    for (const [key, value] of Object.entries(document)) {
      const rendered = cellText(value);
      if (rendered !== void 0) scalars[key] = rendered;
    }
    for (const [field, aliases] of Object.entries(spec.header ?? {})) {
      const value = pick(scalars, aliases);
      if (value !== void 0) header[field] = value;
    }
    for (const [key, value] of Object.entries(scalars)) {
      if (header[key] === void 0) header[key] = value;
    }
  } else {
    throw new MaterialError("\u6750\u6599\u6839\u8282\u70B9\u5FC5\u987B\u662F\u6620\u5C04\u6216\u5217\u8868");
  }
  if (list === void 0 || list === null) {
    throw new MaterialError(
      `\u6750\u6599\u7F3A\u5C11 ${spec.rowKeys.join(" / ")} \u4EFB\u4E00\u5217\u8868\uFF0C\u65E0\u6CD5\u6267\u884C\u68C0\u67E5`
    );
  }
  if (!Array.isArray(list)) throw new MaterialError(`${spec.rowKeys[0] ?? "rows"} \u5FC5\u987B\u662F\u5217\u8868`);
  if (list.length === 0) throw new MaterialError(`${spec.rowKeys[0] ?? "rows"} \u4E3A\u7A7A\u5217\u8868\uFF0C\u65E0\u6CD5\u6267\u884C\u68C0\u67E5`);
  const rowNumberColumns = spec.rowNumberColumns ?? ["row", "\u5E8F\u53F7", "\u884C\u53F7"];
  const rows = list.map((entry, index) => {
    if (!isRecord(entry)) throw new MaterialError(`${spec.rowKeys[0] ?? "rows"}[${index}] \u5FC5\u987B\u662F\u6620\u5C04`);
    const fields = {};
    for (const [key, value] of Object.entries(entry)) {
      if (value === void 0 || value === null) continue;
      if (isRecord(value) || Array.isArray(value)) continue;
      fields[key] = typeof value === "string" ? value.trim() : cellText(value) ?? "";
    }
    const row = { row: index + 1, fields };
    const declared = cellText(entry[rowNumberColumns[0]]) ?? pick(fields, rowNumberColumns);
    if (declared !== void 0 && /^\d+$/.test(declared)) row.row = Number.parseInt(declared, 10);
    return row;
  });
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row.fields)))];
  const expected = spec.requireAnyOf ?? [...new Set(Object.values(spec.columns).flat())];
  const known = new Set(expected.map(normaliseName));
  if (!columns.some((column) => known.has(normaliseName(column)))) {
    throw new MaterialError(
      `\u6750\u6599\u4E2D\u6CA1\u6709\u53EF\u8BC6\u522B\u7684\u5B57\u6BB5\uFF0C\u5DF2\u8BC6\u522B\u7684\u5217\u540D\u4E3A\uFF1A${columns.join(" / ") || "\uFF08\u65E0\uFF09"}\uFF1B\u5DF2\u6309\u4EE5\u4E0B\u540D\u79F0\u67E5\u627E\uFF1A${expected.join(" / ")}`
    );
  }
  return { target, header, rows, columns, warnings };
}
function canonicaliseRow(row, spec) {
  for (const [field, aliases] of Object.entries(spec.columns)) {
    const existing = row.fields[field];
    if (existing !== void 0 && existing !== "") continue;
    const value = pick(row.fields, aliases);
    if (value !== void 0) {
      row.fields[field] = value;
      continue;
    }
    const normalised = new Set(Object.keys(row.fields).map(normaliseName));
    if (aliases.some((alias) => normalised.has(normaliseName(alias)))) row.fields[field] = "";
  }
  return row;
}

// ../../mnt/d/Projects/dsh/checkers/dsh-customs-doc-check/src/shared/datetime.ts
var DATE_PATTERN = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/;
var TIME_PATTERN = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;
function pad(value, width = 2) {
  return String(value).padStart(width, "0");
}
function isRealDate(year, month, day) {
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}
function parseWallClock(raw) {
  const text = raw.trim().replace(/[T\s]+/, " ");
  if (text === "") return void 0;
  const [datePart, timePart] = text.split(" ", 2);
  const dateMatch = DATE_PATTERN.exec(datePart ?? "");
  if (dateMatch === null) return void 0;
  const year = Number.parseInt(dateMatch[1], 10);
  const month = Number.parseInt(dateMatch[2], 10);
  const day = Number.parseInt(dateMatch[3], 10);
  if (!isRealDate(year, month, day)) return void 0;
  const date = `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
  if (timePart === void 0 || timePart === "") return { date, time: "00:00", hasTime: false, minutes: 0 };
  const timeMatch = TIME_PATTERN.exec(timePart);
  if (timeMatch === null) return void 0;
  const hour = Number.parseInt(timeMatch[1], 10);
  const minute = Number.parseInt(timeMatch[2], 10);
  if (hour > 23 || minute > 59) return void 0;
  return { date, time: `${pad(hour)}:${pad(minute)}`, hasTime: true, minutes: hour * 60 + minute };
}
function dayNumber(date) {
  const match = DATE_PATTERN.exec(date);
  if (match === null) throw new Error(`dayNumber: bad date "${date}"`);
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  return Math.round(Date.UTC(year, month - 1, day) / 864e5);
}
function diffDays(from, to) {
  return dayNumber(to) - dayNumber(from);
}
function instant(wall) {
  return dayNumber(wall.date) * 1440 + wall.minutes;
}
function diffMinutes(from, to) {
  return instant(to) - instant(from);
}

// ../../mnt/d/Projects/dsh/checkers/dsh-customs-doc-check/src/shared/report.ts
var LOCATOR_ID_KEYS = ["file", "page", "para", "line", "row", "cell", "column"];
function hashLocator(locator) {
  let hash = 2166136261;
  for (const key of LOCATOR_ID_KEYS) {
    const value = locator[key];
    if (value === void 0) continue;
    const chunk = `${key}=${String(value)};`;
    for (let index = 0; index < chunk.length; index++) {
      hash ^= chunk.charCodeAt(index);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
  }
  return hash.toString(16).padStart(8, "0");
}
function issueId(plugin, ruleId, locator) {
  return `${plugin}.${ruleId}.${hashLocator(locator)}`;
}

// ../../mnt/d/Projects/dsh/checkers/dsh-customs-doc-check/src/shared/rules.ts
function formatBasis(basis, alsoBasis = []) {
  const render = (entry) => {
    const head = entry.number === "" ? entry.document : `${entry.document}\uFF08${entry.number}\uFF09`;
    const qualifier = entry.kind === "derived-from-principle" ? "\uFF3B\u539F\u5219\u6027\u6761\u6B3E\u63A8\u8BBA\uFF0C\u975E\u9488\u5BF9\u672C\u9879\u7684\u660E\u6587\u8981\u6C42\uFF3D" : entry.kind === "institutional-configuration" ? "\uFF3B\u9608\u503C\u4E3A\u672C\u673A\u6784\u914D\u7F6E\uFF0C\u975E\u56FD\u5BB6\u6807\u51C6\uFF3D" : "";
    return `${head} ${entry.clause}\uFF1A\u300C${entry.excerpt}\u300D${qualifier}`;
  };
  const parts = [render(basis), ...alsoBasis.map(render)];
  return parts.length === 1 ? parts[0] : `${parts[0]}\uFF1B\u53E6\u89C1 ${parts.slice(1).join("\uFF1B\u53E6\u89C1 ")}`;
}

// ../../mnt/d/Projects/dsh/checkers/dsh-customs-doc-check/src/shared/rows.ts
function str(params, key, fallback = "") {
  const value = params[key];
  return typeof value === "string" ? value : fallback;
}
function stringList(params, key, fallback) {
  const value = params[key];
  if (Array.isArray(value)) {
    const out = value.filter((entry) => typeof entry === "string");
    if (out.length > 0) return out;
  }
  if (Array.isArray(fallback)) return [...fallback];
  return [];
}
function numberOf(raw) {
  if (raw === void 0) return void 0;
  const normalised = raw.replace(/[\uff10-\uff19]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 65248)).replace(/[,\s\u3000]/g, "");
  const match = /-?\d+(?:\.\d+)?/.exec(normalised);
  if (match === null) return void 0;
  const value = Number(match[0]);
  return Number.isFinite(value) ? value : void 0;
}
function valueOf(input, row, field) {
  const fromRow = row.fields[field];
  if (fromRow !== void 0 && fromRow.trim() !== "") return fromRow;
  const fromHeader = input.header[field];
  if (fromHeader !== void 0 && fromHeader.trim() !== "") return fromHeader;
  return void 0;
}
function filled(value) {
  return value !== void 0 && value.trim() !== "";
}
function provided(input, row, field) {
  return row.fields[field] !== void 0 || input.header[field] !== void 0;
}
function optionalNumber(params, key) {
  const value = params[key];
  if (typeof value !== "number" || !Number.isFinite(value)) return void 0;
  return value;
}
function locatorOf(row, field) {
  const out = {};
  if (row !== void 0) out.row = row;
  if (field !== "") out.field = field;
  return out;
}
function columnExists(input, field) {
  if (input.header[field] !== void 0) return true;
  return input.rows.some((row) => row.fields[field] !== void 0);
}
function presence(ctx) {
  const field = str(ctx.params, "field");
  if (field === "") {
    ctx.skip("\u89C4\u5219\u5E93\u672A\u914D\u7F6E field\uFF0C\u672C\u6761\u4E0D\u6267\u884C");
    return;
  }
  if (!columnExists(ctx.input, field)) {
    ctx.skip(`\u6750\u6599\u6CA1\u6709\u300C${field}\u300D\u5217\uFF0C\u672C\u6761\u4E0D\u9002\u7528`);
    return;
  }
  const covered = ctx.input.rows.filter((row) => provided(ctx.input, row, field));
  if (covered.length === 0) {
    ctx.skip(`\u6750\u6599\u6CA1\u6709\u643A\u5E26\u300C${field}\u300D\u5217\u7684\u884C\uFF0C\u672C\u6761\u4E0D\u9002\u7528`);
    return;
  }
  for (const row of covered) {
    if (filled(valueOf(ctx.input, row, field))) continue;
    ctx.add(
      locatorOf(row.row, field),
      `\u7B2C ${row.row} \u884C\u300C${field}\u300D\u4E3A\u7A7A`,
      `\u300C${field}\u300D\u5E94\u586B\u5199`,
      str(ctx.params, "fix", "\u8865\u586B\u8BE5\u680F\uFF1B\u672C\u6761\u53EA\u6838\u5BF9\u662F\u5426\u586B\u5199\uFF0C\u4E0D\u5224\u65AD\u5185\u5BB9\u662F\u5426\u6070\u5F53")
    );
  }
}
function presenceAny(ctx) {
  const fields = stringList(ctx.params, "fields", "fields");
  if (fields.length === 0) {
    ctx.skip("\u89C4\u5219\u5E93\u672A\u914D\u7F6E fields\uFF0C\u672C\u6761\u4E0D\u6267\u884C");
    return;
  }
  if (!fields.some((field) => columnExists(ctx.input, field))) {
    ctx.skip(`\u6750\u6599\u6CA1\u6709 ${fields.join("\u3001")} \u4E2D\u7684\u4EFB\u4F55\u4E00\u5217\uFF0C\u672C\u6761\u4E0D\u9002\u7528`);
    return;
  }
  const covered = ctx.input.rows.filter((row) => fields.some((field) => provided(ctx.input, row, field)));
  if (covered.length === 0) {
    ctx.skip(`\u6750\u6599\u6CA1\u6709\u643A\u5E26 ${fields.join("\u3001")} \u4EFB\u4E00\u5217\u7684\u884C\uFF0C\u672C\u6761\u4E0D\u9002\u7528`);
    return;
  }
  for (const row of covered) {
    if (fields.some((field) => filled(valueOf(ctx.input, row, field)))) continue;
    ctx.add(
      locatorOf(row.row, fields[0]),
      `\u7B2C ${row.row} \u884C ${fields.join("\u3001")} \u90FD\u4E3A\u7A7A`,
      `${fields.join("\u3001")} \u81F3\u5C11\u5E94\u586B\u5199\u4E00\u9879`,
      str(ctx.params, "fix", "\u81F3\u5C11\u8865\u586B\u4E00\u9879\uFF1B\u672C\u6761\u53EA\u6838\u5BF9\u662F\u5426\u586B\u5199\uFF0C\u4E0D\u5224\u65AD\u5185\u5BB9\u662F\u5426\u6070\u5F53")
    );
  }
}
function enumCheck(ctx) {
  const field = str(ctx.params, "field");
  const allowed = stringList(ctx.params, "values", "values");
  if (field === "") {
    ctx.skip("\u89C4\u5219\u5E93\u672A\u914D\u7F6E field\uFF0C\u672C\u6761\u4E0D\u6267\u884C");
    return;
  }
  if (allowed.length === 0) {
    ctx.skip(`\u89C4\u5219\u5E93\u672A\u914D\u7F6E values\uFF1A\u300C${field}\u300D\u7684\u53D6\u503C\u53E3\u5F84\u7531\u672C\u673A\u6784\u89C4\u5B9A\uFF0C\u672C\u5F15\u64CE\u4E0D\u786C\u7F16\u7801`);
    return;
  }
  if (!columnExists(ctx.input, field)) {
    ctx.skip(`\u6750\u6599\u6CA1\u6709\u300C${field}\u300D\u5217\uFF0C\u672C\u6761\u4E0D\u9002\u7528`);
    return;
  }
  for (const row of ctx.input.rows) {
    const value = (valueOf(ctx.input, row, field) ?? "").trim();
    if (value === "") continue;
    if (allowed.includes(value)) continue;
    ctx.add(
      locatorOf(row.row, field),
      `\u7B2C ${row.row} \u884C\u300C${field}\u300D\u7684\u503C\u4E3A\u300C${value}\u300D`,
      `\u300C${field}\u300D\u5E94\u4E3A ${allowed.join(" / ")} \u4E4B\u4E00`,
      str(ctx.params, "fix", "\u6838\u5BF9\u53D6\u503C\u6765\u6E90\uFF1B\u672C\u6761\u53EA\u6838\u5BF9\u662F\u5426\u5728\u518C\uFF0C\u4E0D\u5224\u65AD\u53D6\u503C\u672C\u8EAB\u662F\u5426\u6070\u5F53")
    );
  }
}
function patternCheck(ctx) {
  const field = str(ctx.params, "field");
  const pattern = str(ctx.params, "pattern");
  if (field === "" || pattern === "") {
    ctx.skip("\u89C4\u5219\u5E93\u672A\u914D\u7F6E field \u6216 pattern\uFF0C\u672C\u6761\u4E0D\u6267\u884C");
    return;
  }
  let matcher;
  try {
    matcher = new RegExp(pattern);
  } catch (error) {
    ctx.skip(`\u89C4\u5219\u5E93\u914D\u7F6E\u7684 pattern \u4E0D\u662F\u5408\u6CD5\u6B63\u5219\uFF1A${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  if (!columnExists(ctx.input, field)) {
    ctx.skip(`\u6750\u6599\u6CA1\u6709\u300C${field}\u300D\u5217\uFF0C\u672C\u6761\u4E0D\u9002\u7528`);
    return;
  }
  for (const row of ctx.input.rows) {
    const value = (valueOf(ctx.input, row, field) ?? "").trim();
    if (value === "") continue;
    if (matcher.test(value)) continue;
    ctx.add(
      locatorOf(row.row, field),
      `\u7B2C ${row.row} \u884C\u300C${field}\u300D\u7684\u503C\u300C${value}\u300D\u4E0D\u7B26\u5408\u914D\u7F6E\u7684\u5F62\u5F0F`,
      `\u300C${field}\u300D\u5E94\u5339\u914D ${pattern}`,
      str(ctx.params, "fix", "\u6838\u5BF9\u586B\u5199\u5F62\u5F0F\uFF1B\u672C\u6761\u53EA\u6838\u5BF9\u5F62\u5F0F\uFF0C\u4E0D\u5224\u65AD\u5185\u5BB9\u662F\u5426\u6B63\u786E")
    );
  }
}
function dateCheck(ctx) {
  const field = str(ctx.params, "field");
  if (field === "") {
    ctx.skip("\u89C4\u5219\u5E93\u672A\u914D\u7F6E field\uFF0C\u672C\u6761\u4E0D\u6267\u884C");
    return;
  }
  const notBeforeField = str(ctx.params, "notBeforeField");
  const notAfterField = str(ctx.params, "notAfterField");
  const notBefore = str(ctx.params, "notBefore");
  const notAfter = str(ctx.params, "notAfter");
  if (!columnExists(ctx.input, field)) {
    ctx.skip(`\u6750\u6599\u6CA1\u6709\u300C${field}\u300D\u5217\uFF0C\u672C\u6761\u4E0D\u9002\u7528`);
    return;
  }
  const today = ctx.options.checkedAt.slice(0, 10);
  for (const row of ctx.input.rows) {
    const raw = (valueOf(ctx.input, row, field) ?? "").trim();
    if (raw === "") continue;
    const parsed = parseWallClock(raw);
    if (parsed === void 0) {
      ctx.add(
        locatorOf(row.row, field),
        `\u7B2C ${row.row} \u884C\u300C${field}\u300D\u7684\u503C\u300C${raw}\u300D\u65E0\u6CD5\u89E3\u6790\u4E3A\u65E5\u671F`,
        `\u300C${field}\u300D\u5E94\u4E3A 2026-03-15 \u6216 2026-03-15 09:30 \u8FD9\u6837\u7684\u53EF\u89E3\u6790\u65E5\u671F`,
        "\u6838\u5BF9\u65E5\u671F\u5199\u6CD5\uFF1B\u672C\u6761\u4E0D\u4F1A\u56E0\u4E3A\u65E0\u6CD5\u89E3\u6790\u800C\u8DF3\u8FC7\u8BE5\u884C"
      );
      continue;
    }
    const lowerRaw = notBeforeField !== "" ? valueOf(ctx.input, row, notBeforeField) ?? "" : notBefore === "today" ? today : notBefore;
    const upperRaw = notAfterField !== "" ? valueOf(ctx.input, row, notAfterField) ?? "" : notAfter === "today" ? today : notAfter;
    if (lowerRaw !== "") {
      const lower = parseWallClock(lowerRaw);
      if (lower === void 0) {
        ctx.add(
          locatorOf(row.row, field),
          `\u7B2C ${row.row} \u884C\u7684\u4E0B\u9650\u65E5\u671F\u300C${lowerRaw}\u300D\u65E0\u6CD5\u89E3\u6790\uFF0C\u65E0\u6CD5\u4E0E\u300C${field}\u300D\u6BD4\u8F83`,
          "\u7528\u4E8E\u6BD4\u8F83\u7684\u65E5\u671F\u5E94\u53EF\u89E3\u6790",
          "\u6838\u5BF9\u65E5\u671F\u5199\u6CD5"
        );
      } else if (parsed.date < lower.date) {
        ctx.add(
          locatorOf(row.row, field),
          `\u7B2C ${row.row} \u884C\u300C${field}\u300D\u4E3A ${parsed.date}\uFF0C\u65E9\u4E8E ${notBeforeField !== "" ? `\u300C${notBeforeField}\u300D\u7684 ` : ""}${lower.date}`,
          `\u300C${field}\u300D\u4E0D\u5E94\u65E9\u4E8E ${lower.date}`,
          str(ctx.params, "fix", "\u6838\u5BF9\u4E24\u4E2A\u65E5\u671F\u7684\u586B\u5199\uFF1B\u672C\u6761\u53EA\u6BD4\u8F83\u5148\u540E")
        );
      }
    }
    if (upperRaw === "") continue;
    const upper = parseWallClock(upperRaw);
    if (upper === void 0) {
      ctx.add(
        locatorOf(row.row, field),
        `\u7B2C ${row.row} \u884C\u7684\u4E0A\u9650\u65E5\u671F\u300C${upperRaw}\u300D\u65E0\u6CD5\u89E3\u6790\uFF0C\u65E0\u6CD5\u4E0E\u300C${field}\u300D\u6BD4\u8F83`,
        "\u7528\u4E8E\u6BD4\u8F83\u7684\u65E5\u671F\u5E94\u53EF\u89E3\u6790",
        "\u6838\u5BF9\u65E5\u671F\u5199\u6CD5"
      );
      continue;
    }
    if (parsed.date <= upper.date) continue;
    ctx.add(
      locatorOf(row.row, field),
      `\u7B2C ${row.row} \u884C\u300C${field}\u300D\u4E3A ${parsed.date}\uFF0C\u665A\u4E8E ${notAfterField !== "" ? `\u300C${notAfterField}\u300D\u7684 ` : ""}${upper.date}`,
      `\u300C${field}\u300D\u4E0D\u5E94\u665A\u4E8E ${upper.date}`,
      str(ctx.params, "fix", "\u6838\u5BF9\u4E24\u4E2A\u65E5\u671F\u7684\u586B\u5199\uFF1B\u672C\u6761\u53EA\u6BD4\u8F83\u5148\u540E")
    );
  }
}
function noFutureDate(ctx) {
  const field = str(ctx.params, "field");
  if (field === "") {
    ctx.skip("\u89C4\u5219\u5E93\u672A\u914D\u7F6E field\uFF0C\u672C\u6761\u4E0D\u6267\u884C");
    return;
  }
  if (!columnExists(ctx.input, field)) {
    ctx.skip(`\u6750\u6599\u6CA1\u6709\u300C${field}\u300D\u5217\uFF0C\u672C\u6761\u4E0D\u9002\u7528`);
    return;
  }
  const today = ctx.options.checkedAt.slice(0, 10);
  for (const row of ctx.input.rows) {
    const raw = (valueOf(ctx.input, row, field) ?? "").trim();
    if (raw === "") continue;
    const parsed = parseWallClock(raw);
    if (parsed === void 0) {
      ctx.add(
        locatorOf(row.row, field),
        `\u7B2C ${row.row} \u884C\u300C${field}\u300D\u4E3A\u300C${raw}\u300D\uFF0C\u65E0\u6CD5\u89E3\u6790\u4E3A\u65E5\u671F`,
        `\u300C${field}\u300D\u5E94\u4E3A ${today} \u4E4B\u524D\u7684\u53EF\u89E3\u6790\u65E5\u671F`,
        "\u6838\u5BF9\u65E5\u671F\u5199\u6CD5\uFF1B\u672C\u6761\u8BC6\u522B 2026-03-15 \u4E0E 2026-03-15 09:30 \u4E24\u79CD\u5F62\u5F0F"
      );
      continue;
    }
    if (parsed.date <= today) continue;
    ctx.add(
      locatorOf(row.row, field),
      `\u7B2C ${row.row} \u884C\u300C${field}\u300D\u4E3A ${parsed.date}\uFF0C\u665A\u4E8E\u6838\u5BF9\u65E5 ${today}`,
      `\u300C${field}\u300D\u5E94\u4E0D\u665A\u4E8E\u6838\u5BF9\u65E5`,
      "\u6838\u5BF9\u65E5\u671F\u662F\u5426\u586B\u9519\uFF1B\u672C\u6761\u53EA\u6838\u5BF9\u5148\u540E\uFF0C\u4E0D\u5224\u65AD\u6570\u636E\u662F\u5426\u53EF\u9760"
    );
  }
}
function dataAge(ctx) {
  const field = str(ctx.params, "field");
  const maxDays = optionalNumber(ctx.params, "maxDays");
  if (field === "") {
    ctx.skip("\u89C4\u5219\u5E93\u672A\u914D\u7F6E field\uFF0C\u672C\u6761\u4E0D\u6267\u884C");
    return;
  }
  if (maxDays === void 0 || maxDays <= 0) {
    ctx.skip(`\u89C4\u5219\u5E93\u672A\u914D\u7F6E maxDays\uFF1A\u300C${field}\u300D\u7684\u6570\u636E\u65B0\u9C9C\u5EA6\u8981\u6C42\u7531\u672C\u673A\u6784\u7F16\u8F91\u53E3\u5F84\u89C4\u5B9A\uFF0C\u672C\u5F15\u64CE\u4E0D\u786C\u7F16\u7801`);
    return;
  }
  if (!columnExists(ctx.input, field)) {
    ctx.skip(`\u6750\u6599\u6CA1\u6709\u300C${field}\u300D\u5217\uFF0C\u672C\u6761\u4E0D\u9002\u7528`);
    return;
  }
  const today = ctx.options.checkedAt.slice(0, 10);
  for (const row of ctx.input.rows) {
    const raw = (valueOf(ctx.input, row, field) ?? "").trim();
    if (raw === "") continue;
    const parsed = parseWallClock(raw);
    if (parsed === void 0) {
      ctx.add(
        locatorOf(row.row, field),
        `\u7B2C ${row.row} \u884C\u300C${field}\u300D\u4E3A\u300C${raw}\u300D\uFF0C\u65E0\u6CD5\u89E3\u6790\u4E3A\u65E5\u671F`,
        `\u300C${field}\u300D\u5E94\u4E3A\u53EF\u89E3\u6790\u65E5\u671F\uFF0C\u4E14\u8DDD\u6838\u5BF9\u65E5\u4E0D\u8D85\u8FC7 ${maxDays} \u5929`,
        "\u6838\u5BF9\u65E5\u671F\u5199\u6CD5"
      );
      continue;
    }
    const age = diffDays(parsed.date, today);
    if (age <= maxDays) continue;
    ctx.add(
      locatorOf(row.row, field),
      `\u7B2C ${row.row} \u884C\u300C${field}\u300D\u4E3A ${parsed.date}\uFF0C\u8DDD\u6838\u5BF9\u65E5 ${age} \u5929\uFF0C\u8D85\u8FC7\u914D\u7F6E\u7684 ${maxDays} \u5929`,
      `\u300C${field}\u300D\u7684\u6570\u636E\u4E0D\u5E94\u65E9\u4E8E\u6838\u5BF9\u65E5\u524D ${maxDays} \u5929`,
      str(ctx.params, "fix", "\u66F4\u65B0\u6570\u636E\u6216\u8BF4\u660E\u5F15\u7528\u65E7\u6570\u636E\u7684\u539F\u56E0\uFF1B\u672C\u6761\u7684\u5929\u6570\u6765\u81EA\u672C\u673A\u6784\u914D\u7F6E\uFF0C\u4E0D\u662F\u6807\u51C6\u6570\u503C")
    );
  }
}
function numberCheck(ctx) {
  const field = str(ctx.params, "field");
  if (field === "") {
    ctx.skip("\u89C4\u5219\u5E93\u672A\u914D\u7F6E field\uFF0C\u672C\u6761\u4E0D\u6267\u884C");
    return;
  }
  const min = optionalNumber(ctx.params, "min");
  const max = optionalNumber(ctx.params, "max");
  const positive = ctx.params.positive === true;
  if (!columnExists(ctx.input, field)) {
    ctx.skip(`\u6750\u6599\u6CA1\u6709\u300C${field}\u300D\u5217\uFF0C\u672C\u6761\u4E0D\u9002\u7528`);
    return;
  }
  for (const row of ctx.input.rows) {
    const raw = (valueOf(ctx.input, row, field) ?? "").trim();
    if (raw === "") continue;
    const value = numberOf(raw);
    if (value === void 0) {
      ctx.add(
        locatorOf(row.row, field),
        `\u7B2C ${row.row} \u884C\u300C${field}\u300D\u7684\u503C\u300C${raw}\u300D\u65E0\u6CD5\u89E3\u6790\u4E3A\u6570\u5B57`,
        `\u300C${field}\u300D\u5E94\u586B\u5199\u6570\u5B57`,
        str(ctx.params, "fix", "\u6838\u5BF9\u586B\u5199\u5F62\u5F0F\uFF1B\u672C\u6761\u53EA\u6838\u5BF9\u53EF\u89E3\u6790\u6027\uFF0C\u4E0D\u5224\u65AD\u6570\u503C\u662F\u5426\u5408\u7406")
      );
      continue;
    }
    if (positive && value <= 0) {
      ctx.add(
        locatorOf(row.row, field),
        `\u7B2C ${row.row} \u884C\u300C${field}\u300D\u4E3A ${value}\uFF0C\u4E0D\u662F\u6B63\u6570`,
        `\u300C${field}\u300D\u5E94\u4E3A\u5927\u4E8E\u96F6\u7684\u6570\u503C`,
        str(ctx.params, "fix", "\u6838\u5BF9\u53D6\u503C\uFF1B\u672C\u6761\u53EA\u6838\u5BF9\u662F\u5426\u4E3A\u6B63\u6570")
      );
      continue;
    }
    if (min !== void 0 && value < min) {
      ctx.add(
        locatorOf(row.row, field),
        `\u7B2C ${row.row} \u884C\u300C${field}\u300D\u4E3A ${value}\uFF0C\u5C0F\u4E8E\u914D\u7F6E\u4E0B\u9650 ${min}`,
        `\u300C${field}\u300D\u5E94\u4E0D\u5C0F\u4E8E ${min}`,
        str(ctx.params, "fix", "\u6838\u5BF9\u53D6\u503C\uFF1B\u672C\u6761\u7684\u4E0A\u4E0B\u9650\u6765\u81EA\u672C\u673A\u6784\u914D\u7F6E")
      );
      continue;
    }
    if (max === void 0 || value <= max) continue;
    ctx.add(
      locatorOf(row.row, field),
      `\u7B2C ${row.row} \u884C\u300C${field}\u300D\u4E3A ${value}\uFF0C\u5927\u4E8E\u914D\u7F6E\u4E0A\u9650 ${max}`,
      `\u300C${field}\u300D\u5E94\u4E0D\u5927\u4E8E ${max}`,
      str(ctx.params, "fix", "\u6838\u5BF9\u53D6\u503C\uFF1B\u672C\u6761\u7684\u4E0A\u4E0B\u9650\u6765\u81EA\u672C\u673A\u6784\u914D\u7F6E")
    );
  }
}
function uniqueCheck(ctx) {
  const field = str(ctx.params, "field");
  if (field === "") {
    ctx.skip("\u89C4\u5219\u5E93\u672A\u914D\u7F6E field\uFF0C\u672C\u6761\u4E0D\u6267\u884C");
    return;
  }
  const seen = /* @__PURE__ */ new Map();
  let considered = 0;
  for (const row of ctx.input.rows) {
    const value = (valueOf(ctx.input, row, field) ?? "").replace(/[\s\u3000]/g, "");
    if (value === "") continue;
    considered += 1;
    const first = seen.get(value);
    if (first === void 0) {
      seen.set(value, row);
      continue;
    }
    ctx.add(
      locatorOf(row.row, field),
      `\u7B2C ${row.row} \u884C\u300C${field}\u300D\u7684\u503C\u300C${valueOf(ctx.input, row, field)}\u300D\u4E0E\u7B2C ${first.row} \u884C\u91CD\u590D`,
      `\u300C${field}\u300D\u5728\u6750\u6599\u5185\u5E94\u552F\u4E00`,
      str(ctx.params, "fix", "\u6838\u5BF9\u662F\u5426\u91CD\u590D\u767B\u8BB0\u6216\u6284\u9519\uFF1B\u672C\u6761\u53EA\u6838\u5BF9\u552F\u4E00\u6027")
    );
  }
  if (considered === 0) {
    ctx.skip(`\u6750\u6599\u6CA1\u6709\u300C${field}\u300D\u5217\uFF0C\u672C\u6761\u4E0D\u9002\u7528`);
  }
}
function sequenceCheck(ctx) {
  const field = str(ctx.params, "field");
  if (field === "") {
    ctx.skip("\u89C4\u5219\u5E93\u672A\u914D\u7F6E field\uFF0C\u672C\u6761\u4E0D\u6267\u884C");
    return;
  }
  const numbers = ctx.input.rows.map((row) => ({ row, value: numberOf(valueOf(ctx.input, row, field)) })).filter((entry) => entry.value !== void 0);
  if (numbers.length < 2) {
    ctx.skip(`\u6750\u6599\u4E2D\u300C${field}\u300D\u53EF\u89E3\u6790\u4E3A\u6570\u5B57\u7684\u884C\u4E0D\u8DB3\u4E24\u884C\uFF0C\u65E0\u6CD5\u6838\u5BF9\u8FDE\u7EED\u6027`);
    return;
  }
  const values = numbers.map((entry) => Math.round(entry.value));
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max - min + 1 > 5e3) {
    ctx.skip(`\u300C${field}\u300D\u7684\u53D6\u503C\u8DE8\u5EA6\u8FC7\u5927\uFF08${min}~${max}\uFF09\uFF0C\u672C\u6761\u4E0D\u6267\u884C`);
    return;
  }
  const present = new Set(values);
  const missing = [];
  for (let value = min; value <= max; value += 1) {
    if (!present.has(value)) missing.push(value);
  }
  if (missing.length === 0) return;
  ctx.add(
    locatorOf(numbers[0]?.row.row, field),
    `${field} \u8303\u56F4 ${min}~${max} \u4E2D\u7F3A ${missing.length} \u4E2A\u53F7\uFF1A${missing.slice(0, 20).join("\u3001")}${missing.length > 20 ? " \u7B49" : ""}`,
    `\u300C${field}\u300D\u5E94\u5728\u540C\u4E00\u8303\u56F4\u5185\u8FDE\u7EED`,
    "\u6838\u5BF9\u662F\u5426\u6F0F\u767B\u8BB0\uFF1B\u7F3A\u53F7\u672C\u8EAB\u4E0D\u6784\u6210\u95EE\u9898\uFF0C\u9700\u4EBA\u5DE5\u786E\u8BA4"
  );
}
function sumCheck(ctx) {
  const field = str(ctx.params, "field");
  const headerField = str(ctx.params, "headerField");
  if (field === "" || headerField === "") {
    ctx.skip("\u89C4\u5219\u5E93\u672A\u914D\u7F6E field \u6216 headerField\uFF0C\u672C\u6761\u4E0D\u6267\u884C");
    return;
  }
  const parsed = ctx.input.rows.map((row) => numberOf(valueOf(ctx.input, row, field))).filter((value) => value !== void 0);
  if (parsed.length === 0) {
    ctx.skip(`\u6750\u6599\u6CA1\u6709\u53EF\u89E3\u6790\u4E3A\u6570\u5B57\u7684\u300C${field}\u300D\u503C\uFF0C\u65E0\u6CD5\u6838\u5BF9\u5408\u8BA1`);
    return;
  }
  const declared = numberOf(ctx.input.header[headerField]);
  if (declared === void 0) {
    ctx.skip(`\u6750\u6599\u672A\u63D0\u4F9B\u53EF\u89E3\u6790\u7684\u300C${headerField}\u300D\uFF0C\u65E0\u6CD5\u4E0E\u300C${field}\u300D\u7684\u5408\u8BA1\u6838\u5BF9`);
    return;
  }
  const total = parsed.reduce((sum, value) => sum + value, 0);
  const tolerance = optionalNumber(ctx.params, "tolerance") ?? 0;
  const gap = Math.abs(total - declared);
  if (gap <= tolerance) return;
  ctx.add(
    locatorOf(void 0, field),
    `${parsed.length} \u884C\u7684\u300C${field}\u300D\u5408\u8BA1 ${Number(total.toFixed(4))}\uFF0C\u4E0E\u300C${headerField}\u300D${declared} \u76F8\u5DEE ${Number(gap.toFixed(4))}`,
    `\u300C${field}\u300D\u7684\u5408\u8BA1\u5E94\u4E0E\u300C${headerField}\u300D\u4E00\u81F4\uFF0C\u5141\u8BB8\u504F\u5DEE ${tolerance}`,
    "\u6838\u5BF9\u662F\u5426\u6709\u884C\u9057\u6F0F\u3001\u91CD\u590D\u8BA1\u5165\u6216\u53E3\u5F84\u4E0D\u4E00\u81F4\uFF1B\u672C\u6761\u53EA\u505A\u52A0\u6CD5\u6838\u5BF9"
  );
}
function sumToConstant(ctx) {
  const field = str(ctx.params, "field");
  const target = optionalNumber(ctx.params, "target");
  if (field === "") {
    ctx.skip("\u89C4\u5219\u5E93\u672A\u914D\u7F6E field\uFF0C\u672C\u6761\u4E0D\u6267\u884C");
    return;
  }
  if (target === void 0 || target <= 0) {
    ctx.skip(`\u89C4\u5219\u5E93\u672A\u914D\u7F6E target\uFF1A\u300C${field}\u300D\u7684\u5408\u8BA1\u76EE\u6807\u7531\u62DB\u6807\u6587\u4EF6\u6216\u672C\u673A\u6784\u53E3\u5F84\u89C4\u5B9A\uFF0C\u672C\u5F15\u64CE\u4E0D\u786C\u7F16\u7801`);
    return;
  }
  const parsed = ctx.input.rows.map((row) => numberOf(valueOf(ctx.input, row, field))).filter((value) => value !== void 0);
  if (parsed.length === 0) {
    ctx.skip(`\u6750\u6599\u6CA1\u6709\u53EF\u89E3\u6790\u4E3A\u6570\u5B57\u7684\u300C${field}\u300D\u503C\uFF0C\u65E0\u6CD5\u6838\u5BF9\u5408\u8BA1`);
    return;
  }
  const tolerance = optionalNumber(ctx.params, "tolerance") ?? 0;
  const total = parsed.reduce((sum, value) => sum + value, 0);
  const gap = Math.abs(total - target);
  if (gap <= tolerance) return;
  ctx.add(
    locatorOf(void 0, field),
    `${parsed.length} \u884C\u7684\u300C${field}\u300D\u5408\u8BA1 ${Number(total.toFixed(4))}\uFF0C\u4E0E\u914D\u7F6E\u7684\u76EE\u6807\u503C ${target} \u76F8\u5DEE ${Number(gap.toFixed(4))}`,
    `\u300C${field}\u300D\u7684\u5408\u8BA1\u5E94\u4E3A ${target}\uFF0C\u5141\u8BB8\u504F\u5DEE ${tolerance}`,
    // The default fix text must survive wording.ts's guard, which scans the
    // RENDERED report for adjudicating phrases and throws. An earlier version
    // ended "…不判断设置是否合规", which reads as a disclaimer but is a bare
    // substring hit, so every rule that fell through to this default crashed the
    // renderer the first time it fired. Disclaimers have to be phrased without
    // the forbidden words, not around them.
    str(ctx.params, "fix", "\u6838\u5BF9\u662F\u5426\u6709\u884C\u9057\u6F0F\u6216\u6570\u503C\u6284\u9519\uFF1B\u672C\u6761\u53EA\u505A\u52A0\u6CD5\u6838\u5BF9\uFF0C\u4E0D\u8BC4\u4EF7\u5206\u503C\u8BBE\u7F6E\u672C\u8EAB")
  );
}
function countPerGroup(ctx) {
  const field = str(ctx.params, "field");
  const minRows = optionalNumber(ctx.params, "minRows") ?? 1;
  if (field === "") {
    ctx.skip("\u89C4\u5219\u5E93\u672A\u914D\u7F6E field\uFF0C\u672C\u6761\u4E0D\u6267\u884C");
    return;
  }
  const groups = /* @__PURE__ */ new Map();
  for (const row of ctx.input.rows) {
    const value = (valueOf(ctx.input, row, field) ?? "").trim();
    if (value === "") continue;
    const bucket = groups.get(value);
    if (bucket === void 0) groups.set(value, [row]);
    else bucket.push(row);
  }
  if (groups.size === 0) {
    ctx.skip(`\u6750\u6599\u6CA1\u6709\u300C${field}\u300D\u5217\uFF0C\u672C\u6761\u4E0D\u9002\u7528`);
    return;
  }
  for (const [value, rows] of groups) {
    if (rows.length >= minRows) continue;
    ctx.add(
      locatorOf(rows[0]?.row, field),
      `\u300C${field}\u300D\u4E3A\u300C${value}\u300D\u7684\u53EA\u6709 ${rows.length} \u884C\uFF0C\u5C11\u4E8E\u914D\u7F6E\u7684 ${minRows} \u884C`,
      `\u6BCF\u4E2A\u300C${field}\u300D\u5E94\u81F3\u5C11\u51FA\u73B0 ${minRows} \u884C`,
      str(ctx.params, "fix", "\u6838\u5BF9\u662F\u5426\u6F0F\u767B\u8BB0\uFF1B\u672C\u6761\u53EA\u6838\u5BF9\u884C\u6570\uFF0C\u4E0D\u5224\u65AD\u5185\u5BB9\u662F\u5426\u5B8C\u6574")
    );
  }
}
function textContains(ctx) {
  const field = str(ctx.params, "field");
  const terms = stringList(ctx.params, "terms", "terms");
  if (field === "" || terms.length === 0) {
    ctx.skip("\u89C4\u5219\u5E93\u672A\u914D\u7F6E field \u6216 terms\uFF0C\u672C\u6761\u4E0D\u6267\u884C");
    return;
  }
  if (!columnExists(ctx.input, field)) {
    ctx.skip(`\u6750\u6599\u6CA1\u6709\u300C${field}\u300D\u5217\uFF0C\u672C\u6761\u4E0D\u9002\u7528`);
    return;
  }
  for (const row of ctx.input.rows) {
    const text = valueOf(ctx.input, row, field) ?? "";
    if (text === "") continue;
    const missing = terms.filter((term) => !text.includes(term));
    if (missing.length === 0) continue;
    ctx.add(
      locatorOf(row.row, field),
      `\u7B2C ${row.row} \u884C\u300C${field}\u300D\u4E2D\u672A\u89C1 ${missing.join("\u3001")}`,
      `\u300C${field}\u300D\u5E94\u5305\u542B ${terms.join("\u3001")}`,
      str(ctx.params, "fix", "\u6838\u5BF9\u662F\u5426\u9057\u6F0F\uFF1B\u672C\u6761\u53EA\u6838\u5BF9\u5B57\u9762\u662F\u5426\u51FA\u73B0\uFF0C\u4E0D\u5224\u65AD\u8868\u8FF0\u662F\u5426\u6070\u5F53")
    );
  }
}
function containsAny(ctx) {
  const field = str(ctx.params, "field");
  const terms = stringList(ctx.params, "terms", "terms");
  if (field === "" || terms.length === 0) {
    ctx.skip("\u89C4\u5219\u5E93\u672A\u914D\u7F6E field \u6216 terms\uFF0C\u672C\u6761\u4E0D\u6267\u884C");
    return;
  }
  if (!columnExists(ctx.input, field)) {
    ctx.skip(`\u6750\u6599\u6CA1\u6709\u300C${field}\u300D\u5217\uFF0C\u672C\u6761\u4E0D\u9002\u7528`);
    return;
  }
  for (const row of ctx.input.rows) {
    const text = valueOf(ctx.input, row, field) ?? "";
    if (text === "") continue;
    const hit = terms.find((term) => text.includes(term));
    if (hit === void 0) continue;
    ctx.add(
      locatorOf(row.row, field),
      `\u7B2C ${row.row} \u884C\u300C${field}\u300D\u4E2D\u6B8B\u7559\u5360\u4F4D\u7B26\u300C${hit}\u300D`,
      `\u300C${field}\u300D\u5E94\u586B\u5199\u5B9E\u9645\u5185\u5BB9\uFF0C\u4E0D\u542B\u672A\u66FF\u6362\u7684\u5360\u4F4D\u7B26`,
      str(ctx.params, "fix", "\u6838\u5BF9\u662F\u5426\u76F4\u63A5\u7167\u6284\u4E86\u6A21\u677F")
    );
  }
}
function lengthCheck(ctx) {
  const field = str(ctx.params, "field");
  if (field === "") {
    ctx.skip("\u89C4\u5219\u5E93\u672A\u914D\u7F6E field\uFF0C\u672C\u6761\u4E0D\u6267\u884C");
    return;
  }
  if (!columnExists(ctx.input, field)) {
    ctx.skip(`\u6750\u6599\u6CA1\u6709\u300C${field}\u300D\u5217\uFF0C\u672C\u6761\u4E0D\u9002\u7528`);
    return;
  }
  const max = optionalNumber(ctx.params, "maxLength");
  const min = optionalNumber(ctx.params, "minLength");
  if (max === void 0 && min === void 0) {
    ctx.skip(`\u89C4\u5219\u5E93\u672A\u914D\u7F6E maxLength \u6216 minLength\uFF1A\u300C${field}\u300D\u7684\u957F\u5EA6\u9650\u5236\u5C5E\u672C\u673A\u6784\u53E3\u5F84\uFF0C\u672C\u6761\u4E0D\u6267\u884C`);
    return;
  }
  for (const row of ctx.input.rows) {
    const value = valueOf(ctx.input, row, field) ?? "";
    if (value === "") continue;
    const count = [...value].length;
    if (max !== void 0 && count > max) {
      ctx.add(
        locatorOf(row.row, field),
        `\u7B2C ${row.row} \u884C\u300C${field}\u300D\u5171 ${count} \u5B57\uFF0C\u8D85\u8FC7\u914D\u7F6E\u4E0A\u9650 ${max} \u5B57`,
        `\u300C${field}\u300D\u5E94\u4E0D\u8D85\u8FC7 ${max} \u5B57`,
        str(ctx.params, "fix", "\u6838\u5BF9\u957F\u5EA6\u9650\u5236\u6765\u6E90\uFF1B\u672C\u6761\u7684\u4E0A\u4E0B\u9650\u6765\u81EA\u672C\u673A\u6784\u914D\u7F6E")
      );
      continue;
    }
    if (min === void 0 || count >= min) continue;
    ctx.add(
      locatorOf(row.row, field),
      `\u7B2C ${row.row} \u884C\u300C${field}\u300D\u5171 ${count} \u5B57\uFF0C\u5C11\u4E8E\u914D\u7F6E\u4E0B\u9650 ${min} \u5B57`,
      `\u300C${field}\u300D\u5E94\u4E0D\u5C11\u4E8E ${min} \u5B57`,
      str(ctx.params, "fix", "\u6838\u5BF9\u662F\u5426\u6F0F\u586B\uFF1B\u672C\u6761\u7684\u4E0A\u4E0B\u9650\u6765\u81EA\u672C\u673A\u6784\u914D\u7F6E")
    );
  }
}
function minLength(ctx) {
  const field = str(ctx.params, "field");
  const min = optionalNumber(ctx.params, "minLength");
  if (field === "" || min === void 0 || min <= 0) {
    ctx.skip("\u89C4\u5219\u5E93\u672A\u914D\u7F6E field \u6216 minLength\uFF0C\u672C\u6761\u4E0D\u6267\u884C");
    return;
  }
  if (!columnExists(ctx.input, field)) {
    ctx.skip(`\u6750\u6599\u6CA1\u6709\u300C${field}\u300D\u5217\uFF0C\u672C\u6761\u4E0D\u9002\u7528`);
    return;
  }
  for (const row of ctx.input.rows) {
    const value = (valueOf(ctx.input, row, field) ?? "").trim();
    if (value === "") continue;
    const count = [...value].length;
    if (count >= min) continue;
    ctx.add(
      locatorOf(row.row, field),
      `\u7B2C ${row.row} \u884C\u300C${field}\u300D\u53EA\u6709 ${count} \u5B57\uFF0C\u77ED\u4E8E\u914D\u7F6E\u4E0B\u9650 ${min} \u5B57`,
      `\u300C${field}\u300D\u5E94\u81F3\u5C11\u6709 ${min} \u5B57`,
      str(ctx.params, "fix", "\u6838\u5BF9\u662F\u5426\u771F\u7684\u662F\u6458\u5F55\uFF1B\u672C\u6761\u53EA\u6838\u5BF9\u957F\u5EA6\uFF0C\u4E0D\u5224\u65AD\u5185\u5BB9\u662F\u5426\u5FE0\u5B9E\u4E8E\u539F\u6587")
    );
  }
}
function headerPresence(ctx) {
  const fields = stringList(ctx.params, "fields", "fields");
  if (fields.length === 0) {
    ctx.skip("\u89C4\u5219\u5E93\u672A\u914D\u7F6E fields\uFF0C\u672C\u6761\u4E0D\u6267\u884C");
    return;
  }
  const missing = fields.filter((field) => !filled(ctx.input.header[field]));
  if (missing.length === 0) return;
  ctx.add(
    locatorOf(void 0, missing[0]),
    `\u6750\u6599\u8868\u5934\u7F3A\u5C11 ${missing.join("\u3001")}`,
    `\u8868\u5934\u5E94\u63D0\u4F9B ${fields.join("\u3001")}`,
    str(ctx.params, "fix", "\u8865\u9F50\u8868\u5934\u5B57\u6BB5\uFF1B\u672C\u6761\u53EA\u6838\u5BF9\u8868\u5934\u662F\u5426\u58F0\u660E\uFF0C\u4E0D\u5224\u65AD\u5185\u5BB9\u662F\u5426\u6070\u5F53")
  );
}
function headerEnum(ctx) {
  const field = str(ctx.params, "field");
  const values = stringList(ctx.params, "values", "values");
  if (field === "") {
    ctx.skip("\u89C4\u5219\u5E93\u672A\u914D\u7F6E field\uFF0C\u672C\u6761\u4E0D\u6267\u884C");
    return;
  }
  const actual = (ctx.input.header[field] ?? "").trim();
  if (actual === "") {
    ctx.skip(`\u6750\u6599\u8868\u5934\u672A\u63D0\u4F9B\u300C${field}\u300D\uFF0C\u672C\u6761\u4E0D\u9002\u7528`);
    return;
  }
  if (values.length === 0) {
    ctx.skip(`\u89C4\u5219\u5E93\u672A\u914D\u7F6E values\uFF1A\u300C${field}\u300D\u7684\u53D6\u503C\u53E3\u5F84\u7531\u987E\u5BA2\u6216\u672C\u673A\u6784\u89C4\u5B9A\uFF0C\u672C\u5F15\u64CE\u4E0D\u786C\u7F16\u7801`);
    return;
  }
  if (values.includes(actual)) return;
  ctx.add(
    locatorOf(void 0, field),
    `\u6750\u6599\u8868\u5934\u300C${field}\u300D\u7684\u503C\u4E3A\u300C${actual}\u300D`,
    `\u300C${field}\u300D\u5E94\u4E3A ${values.join(" / ")} \u4E4B\u4E00`,
    "\u6838\u5BF9\u53D6\u503C\u6765\u6E90\uFF1B\u672C\u6761\u53EA\u6838\u5BF9\u662F\u5426\u5728\u518C\uFF0C\u4E0D\u5224\u65AD\u8BE5\u53D6\u503C\u672C\u8EAB\u662F\u5426\u6070\u5F53"
  );
}
function conditionalPresence(ctx) {
  const conditionField = str(ctx.params, "conditionField");
  const required = stringList(ctx.params, "requiredFields", "requiredFields");
  if (conditionField === "" || required.length === 0) {
    ctx.skip("\u89C4\u5219\u5E93\u672A\u914D\u7F6E conditionField \u6216 requiredFields\uFF0C\u672C\u6761\u4E0D\u6267\u884C");
    return;
  }
  const values = stringList(ctx.params, "conditionValues", "conditionValues");
  const pattern = str(ctx.params, "conditionPattern");
  let matcher;
  if (pattern !== "") {
    try {
      matcher = new RegExp(pattern);
    } catch (error) {
      ctx.skip(`\u89C4\u5219\u5E93\u914D\u7F6E\u7684 conditionPattern \u4E0D\u662F\u5408\u6CD5\u6B63\u5219\uFF1A${error instanceof Error ? error.message : String(error)}`);
      return;
    }
  }
  const triggered = ctx.input.rows.filter((row) => {
    const value = (valueOf(ctx.input, row, conditionField) ?? "").trim();
    if (value === "") return false;
    if (values.length > 0) return values.some((candidate) => candidate === value);
    if (matcher !== void 0) return matcher.test(value);
    return true;
  });
  if (triggered.length === 0) {
    ctx.skip(`\u6750\u6599\u4E2D\u6CA1\u6709\u6EE1\u8DB3\u300C${conditionField}\u300D\u6761\u4EF6\u7684\u884C\uFF0C\u672C\u6761\u4E0D\u9002\u7528`);
    return;
  }
  for (const row of triggered) {
    const missing = required.filter((field) => !filled(valueOf(ctx.input, row, field)));
    if (missing.length === 0) continue;
    ctx.add(
      locatorOf(row.row, conditionField),
      `\u7B2C ${row.row} \u884C\u300C${conditionField}\u300D\u4E3A\u300C${valueOf(ctx.input, row, conditionField)}\u300D\uFF0C\u4F46\u7F3A ${missing.join("\u3001")}`,
      `\u6EE1\u8DB3\u8BE5\u6761\u4EF6\u7684\u884C\u5E94\u540C\u65F6\u586B\u5199 ${required.join("\u3001")}`,
      str(ctx.params, "fix", "\u8865\u9F50\uFF1B\u672C\u6761\u53EA\u6838\u5BF9\u5B57\u6BB5\u662F\u5426\u5B58\u5728\uFF0C\u4E0D\u5224\u65AD\u5185\u5BB9\u662F\u5426\u6070\u5F53")
    );
  }
}
function highRiskEvidence(ctx) {
  const keywords = stringList(ctx.params, "highRiskKeywords", "highRiskKeywords");
  if (keywords.length === 0) {
    ctx.skip("\u89C4\u5219\u5E93\u672A\u914D\u7F6E highRiskKeywords\uFF1A\u54EA\u4E9B\u6761\u6B3E\u5C5E\u4E8E\u9AD8\u98CE\u9669\u53D6\u51B3\u4E8E\u62DB\u6807\u6587\u4EF6\u672C\u8EAB\uFF0C\u672C\u5F15\u64CE\u4E0D\u786C\u7F16\u7801");
    return;
  }
  const evidenceField = str(ctx.params, "evidenceField", "evidence");
  const requirementField = str(ctx.params, "requirementField", "requirement");
  const matching = ctx.input.rows.filter((row) => {
    const text = valueOf(ctx.input, row, requirementField) ?? "";
    return text !== "" && keywords.some((keyword) => text.includes(keyword));
  });
  if (matching.length === 0) {
    ctx.skip(`\u6750\u6599\u4E2D\u6CA1\u6709\u547D\u4E2D\u9AD8\u98CE\u9669\u5173\u952E\u8BCD\uFF08${keywords.join("\u3001")}\uFF09\u7684\u6761\u6B3E\uFF0C\u672C\u6761\u4E0D\u9002\u7528`);
    return;
  }
  for (const row of matching) {
    if (filled(valueOf(ctx.input, row, evidenceField))) continue;
    const text = valueOf(ctx.input, row, requirementField) ?? "";
    const hit = keywords.find((keyword) => text.includes(keyword));
    ctx.add(
      locatorOf(row.row, evidenceField),
      `\u7B2C ${row.row} \u884C\u7684\u8981\u6C42\u547D\u4E2D\u9AD8\u98CE\u9669\u5173\u952E\u8BCD\u300C${hit}\u300D\uFF0C\u4F46\u672A\u586B\u5199\u8BC1\u660E\u6750\u6599`,
      `\u547D\u4E2D ${keywords.join(" / ")} \u7684\u6761\u6B3E\u5E94\u586B\u5199\u8BC1\u660E\u6750\u6599`,
      "\u8865\u586B\u8BC1\u660E\u6750\u6599\u6216\u9875\u7801\uFF1B\u672C\u6761\u53EA\u6838\u5BF9\u662F\u5426\u586B\u5199\uFF0C\u4E0D\u5224\u65AD\u8BC1\u660E\u6750\u6599\u662F\u5426\u6709\u6548"
    );
  }
}
function thresholdPresence(ctx) {
  const triggerField = str(ctx.params, "triggerField");
  const requiredField = str(ctx.params, "requiredField");
  const threshold = optionalNumber(ctx.params, "threshold");
  if (triggerField === "" || requiredField === "") {
    ctx.skip("\u89C4\u5219\u5E93\u672A\u914D\u7F6E triggerField \u6216 requiredField\uFF0C\u672C\u6761\u4E0D\u6267\u884C");
    return;
  }
  if (threshold === void 0 || threshold <= 0) {
    ctx.skip("\u89C4\u5219\u5E93\u672A\u914D\u7F6E threshold\uFF1A\u300C\u591A\u9AD8\u7B97\u9AD8\u98CE\u9669\u3001\u591A\u9AD8\u5FC5\u987B\u63D0\u63AA\u65BD\u300D\u53D6\u51B3\u4E8E\u672C\u673A\u6784\u98CE\u9669\u51C6\u5219\uFF0C\u672C\u5F15\u64CE\u4E0D\u786C\u7F16\u7801");
    return;
  }
  const triggered = ctx.input.rows.filter((row) => {
    const value = numberOf(valueOf(ctx.input, row, triggerField));
    return value !== void 0 && value >= threshold;
  });
  if (triggered.length === 0) {
    ctx.skip(`\u6750\u6599\u4E2D\u6CA1\u6709\u300C${triggerField}\u300D\u8FBE\u5230 ${threshold} \u7684\u884C\uFF0C\u672C\u6761\u4E0D\u9002\u7528`);
    return;
  }
  for (const row of triggered) {
    if (filled(valueOf(ctx.input, row, requiredField))) continue;
    ctx.add(
      locatorOf(row.row, requiredField),
      `\u7B2C ${row.row} \u884C\u300C${triggerField}\u300D\u4E3A ${valueOf(ctx.input, row, triggerField)}\uFF0C\u8FBE\u5230\u914D\u7F6E\u9608\u503C ${threshold}\uFF0C\u4F46\u672A\u586B\u5199\u300C${requiredField}\u300D`,
      `\u300C${triggerField}\u300D\u8FBE\u5230 ${threshold} \u7684\u884C\u5E94\u586B\u5199\u300C${requiredField}\u300D`,
      "\u8865\u586B\uFF1B\u672C\u6761\u7684\u9608\u503C\u6765\u81EA\u672C\u673A\u6784\u914D\u7F6E\uFF0C\u4E0D\u662F\u6807\u51C6\u6570\u503C"
    );
  }
}
function thresholdBelow(ctx) {
  const field = str(ctx.params, "field");
  const threshold = optionalNumber(ctx.params, "threshold");
  if (field === "") {
    ctx.skip("\u89C4\u5219\u5E93\u672A\u914D\u7F6E field\uFF0C\u672C\u6761\u4E0D\u6267\u884C");
    return;
  }
  if (threshold === void 0 || threshold <= 0) {
    ctx.skip("\u89C4\u5219\u5E93\u672A\u914D\u7F6E threshold\uFF1A\u63A5\u6536\u51C6\u5219\u56E0\u884C\u4E1A\u3001\u987E\u5BA2\u4E0E\u7279\u6027\u91CD\u8981\u5EA6\u800C\u5F02\uFF0C\u672C\u5F15\u64CE\u4E0D\u786C\u7F16\u7801\u4EFB\u4F55\u51C6\u5219");
    return;
  }
  if (!columnExists(ctx.input, field)) {
    ctx.skip(`\u6750\u6599\u6CA1\u6709\u300C${field}\u300D\u5217\uFF0C\u672C\u6761\u4E0D\u9002\u7528`);
    return;
  }
  for (const row of ctx.input.rows) {
    const value = numberOf(valueOf(ctx.input, row, field));
    if (value === void 0) continue;
    if (value >= threshold) continue;
    ctx.add(
      locatorOf(row.row, field),
      `\u7B2C ${row.row} \u884C\u300C${field}\u300D\u4E3A ${value}\uFF0C\u4F4E\u4E8E\u672C\u673A\u6784\u914D\u7F6E\u7684\u51C6\u5219 ${threshold}`,
      `\u300C${field}\u300D\u5E94\u4E0D\u4F4E\u4E8E ${threshold}`,
      str(ctx.params, "fix", "\u6838\u5BF9\u53D6\u503C\uFF1B\u672C\u6761\u7684\u51C6\u5219\u6765\u81EA\u672C\u673A\u6784\u6216\u987E\u5BA2\u914D\u7F6E\uFF0C\u4E0D\u662F\u6807\u51C6\u6570\u503C")
    );
  }
}
function fieldComparison(ctx) {
  const leftField = str(ctx.params, "leftField");
  const rightField = str(ctx.params, "rightField");
  const relation = str(ctx.params, "relation", "gte");
  if (leftField === "" || rightField === "") {
    ctx.skip("\u89C4\u5219\u5E93\u672A\u914D\u7F6E leftField \u6216 rightField\uFF0C\u672C\u6761\u4E0D\u6267\u884C");
    return;
  }
  const label = {
    gte: "\u4E0D\u5C0F\u4E8E",
    gt: "\u5927\u4E8E",
    lte: "\u4E0D\u5927\u4E8E",
    lt: "\u5C0F\u4E8E",
    eq: "\u7B49\u4E8E"
  };
  const comparable = ctx.input.rows.filter(
    (row) => filled(valueOf(ctx.input, row, leftField)) && filled(valueOf(ctx.input, row, rightField))
  );
  if (comparable.length === 0) {
    ctx.skip(`\u6750\u6599\u6CA1\u6709\u540C\u65F6\u586B\u5199\u300C${leftField}\u300D\u4E0E\u300C${rightField}\u300D\u7684\u884C\uFF0C\u672C\u6761\u4E0D\u9002\u7528`);
    return;
  }
  for (const row of comparable) {
    const leftRaw = valueOf(ctx.input, row, leftField) ?? "";
    const rightRaw = valueOf(ctx.input, row, rightField) ?? "";
    const left = numberOf(leftRaw);
    const right = numberOf(rightRaw);
    const leftDate = left === void 0 ? parseWallClock(leftRaw) : void 0;
    const rightDate = right === void 0 ? parseWallClock(rightRaw) : void 0;
    let ok;
    if (left !== void 0 && right !== void 0) {
      ok = relation === "gte" ? left >= right : relation === "gt" ? left > right : relation === "lte" ? left <= right : relation === "lt" ? left < right : relation === "eq" ? left === right : void 0;
    } else if (leftDate !== void 0 && rightDate !== void 0) {
      ok = relation === "gte" ? leftDate.date >= rightDate.date : relation === "gt" ? leftDate.date > rightDate.date : relation === "lte" ? leftDate.date <= rightDate.date : relation === "lt" ? leftDate.date < rightDate.date : relation === "eq" ? leftDate.date === rightDate.date : void 0;
    }
    if (ok === void 0) {
      ctx.add(
        locatorOf(row.row, leftField),
        `\u7B2C ${row.row} \u884C\u300C${leftField}\u300D${leftRaw} \u4E0E\u300C${rightField}\u300D${rightRaw} \u65E0\u6CD5\u4F5C\u4E3A\u53EF\u6BD4\u6570\u503C\u6216\u65E5\u671F\u6BD4\u8F83`,
        `\u300C${leftField}\u300D\u5E94${label[relation] ?? relation}\u300C${rightField}\u300D`,
        "\u6838\u5BF9\u4E24\u680F\u7684\u586B\u5199\u5F62\u5F0F\uFF1B\u672C\u6761\u53EA\u505A\u6BD4\u8F83\uFF0C\u4E0D\u5224\u65AD\u6570\u503C\u662F\u5426\u771F\u5B9E"
      );
      continue;
    }
    if (ok) continue;
    ctx.add(
      locatorOf(row.row, leftField),
      `\u7B2C ${row.row} \u884C\u300C${leftField}\u300D\u4E3A ${leftRaw}\uFF0C\u300C${rightField}\u300D\u4E3A ${rightRaw}\uFF0C\u4E0D\u6EE1\u8DB3${label[relation] ?? relation}\u5173\u7CFB`,
      `\u300C${leftField}\u300D\u5E94${label[relation] ?? relation}\u300C${rightField}\u300D`,
      str(ctx.params, "fix", "\u6838\u5BF9\u4E24\u680F\u662F\u5426\u586B\u53CD\u6216\u6284\u9519\uFF1B\u672C\u6761\u53EA\u505A\u6BD4\u8F83\uFF0C\u4E0D\u5224\u65AD\u6570\u503C\u662F\u5426\u771F\u5B9E")
    );
  }
}
function intervalOrder(ctx) {
  const lowerField = str(ctx.params, "lowerField");
  const middleField = str(ctx.params, "middleField");
  const upperField = str(ctx.params, "upperField");
  if (lowerField === "" || middleField === "" || upperField === "") {
    ctx.skip("\u89C4\u5219\u5E93\u672A\u914D\u7F6E lowerField\u3001middleField \u6216 upperField\uFF0C\u672C\u6761\u4E0D\u6267\u884C");
    return;
  }
  const usable = ctx.input.rows.filter(
    (row) => filled(valueOf(ctx.input, row, lowerField)) && filled(valueOf(ctx.input, row, middleField)) && filled(valueOf(ctx.input, row, upperField))
  );
  if (usable.length === 0) {
    ctx.skip(`\u6750\u6599\u6CA1\u6709\u540C\u65F6\u586B\u5199\u300C${lowerField}\u300D\u300C${middleField}\u300D\u300C${upperField}\u300D\u7684\u884C\uFF0C\u672C\u6761\u4E0D\u9002\u7528`);
    return;
  }
  for (const row of usable) {
    const lower = numberOf(valueOf(ctx.input, row, lowerField));
    const middle = numberOf(valueOf(ctx.input, row, middleField));
    const upper = numberOf(valueOf(ctx.input, row, upperField));
    if (lower === void 0 || middle === void 0 || upper === void 0) {
      ctx.add(
        locatorOf(row.row, middleField),
        `\u7B2C ${row.row} \u884C\u7684\u300C${lowerField}\u300D\u300C${middleField}\u300D\u300C${upperField}\u300D\u4E2D\u6709\u65E0\u6CD5\u89E3\u6790\u4E3A\u6570\u503C\u7684\u503C`,
        `\u4E09\u4E2A\u503C\u5E94\u53EF\u6BD4\u8F83\uFF0C\u4E14\u6EE1\u8DB3 ${lowerField} \u2264 ${middleField} \u2264 ${upperField}`,
        "\u6838\u5BF9\u586B\u5199\u5F62\u5F0F"
      );
      continue;
    }
    if (lower <= middle && middle <= upper) continue;
    ctx.add(
      locatorOf(row.row, middleField),
      `\u7B2C ${row.row} \u884C\u300C${middleField}\u300D\u4E3A ${middle}\uFF0C\u800C\u300C${lowerField}\u300D\u4E3A ${lower}\u3001\u300C${upperField}\u300D\u4E3A ${upper}`,
      `\u5E94\u6EE1\u8DB3 ${lowerField} \u2264 ${middleField} \u2264 ${upperField}`,
      "\u6838\u5BF9\u4E09\u4E2A\u6570\u503C\u7684\u586B\u5199\uFF1B\u672C\u6761\u53EA\u6838\u5BF9\u6B21\u5E8F\uFF0C\u4E0D\u5224\u65AD\u6570\u503C\u662F\u5426\u6B63\u786E"
    );
  }
}
function productOf(ctx) {
  const resultField = str(ctx.params, "resultField");
  const factors = stringList(ctx.params, "factorFields", "factorFields");
  if (resultField === "" || factors.length === 0) {
    ctx.skip("\u89C4\u5219\u5E93\u672A\u914D\u7F6E resultField \u6216 factorFields\uFF0C\u672C\u6761\u4E0D\u6267\u884C");
    return;
  }
  const tolerance = optionalNumber(ctx.params, "tolerance") ?? 0;
  const usable = ctx.input.rows.filter(
    (row) => filled(valueOf(ctx.input, row, resultField)) && factors.every((factor) => filled(valueOf(ctx.input, row, factor)))
  );
  if (usable.length === 0) {
    ctx.skip(`\u6750\u6599\u6CA1\u6709\u540C\u65F6\u586B\u5199\u300C${resultField}\u300D\u4E0E ${factors.join("\u3001")} \u7684\u884C\uFF0C\u65E0\u6CD5\u6838\u5BF9\u4E58\u79EF`);
    return;
  }
  const round = (value) => Number(value.toFixed(6));
  for (const row of usable) {
    const declared = numberOf(valueOf(ctx.input, row, resultField));
    const values = factors.map((factor) => numberOf(valueOf(ctx.input, row, factor)));
    if (declared === void 0 || values.some((value) => value === void 0)) {
      ctx.add(
        locatorOf(row.row, resultField),
        `\u7B2C ${row.row} \u884C\u7684\u300C${resultField}\u300D\u6216 ${factors.join("\u3001")} \u4E2D\u6709\u65E0\u6CD5\u89E3\u6790\u4E3A\u6570\u503C\u7684\u503C`,
        `\u300C${resultField}\u300D\u5E94\u7B49\u4E8E ${factors.join(" \xD7 ")}`,
        "\u6838\u5BF9\u586B\u5199\u5F62\u5F0F\uFF1B\u672C\u6761\u53EA\u505A\u7B97\u672F\u6838\u5BF9\uFF0C\u4E0D\u5224\u65AD\u5404\u56E0\u5B50\u662F\u5426\u6B63\u786E"
      );
      continue;
    }
    const numbers = values;
    const product = numbers.reduce((total, value) => total * value, 1);
    if (Math.abs(product - declared) <= tolerance) continue;
    ctx.add(
      locatorOf(row.row, resultField),
      `\u7B2C ${row.row} \u884C\u300C${resultField}\u300D\u586B\u62A5 ${declared}\uFF0C\u800C ${numbers.join(" \xD7 ")} = ${round(product)}`,
      `\u300C${resultField}\u300D\u5E94\u7B49\u4E8E ${factors.join(" \xD7 ")}`,
      "\u6838\u5BF9\u662F\u5426\u6284\u9519\u6216\u6F0F\u6539\uFF1B\u672C\u6761\u53EA\u505A\u7B97\u672F\u6838\u5BF9\uFF0C\u4E0D\u5224\u65AD\u5404\u56E0\u5B50\u662F\u5426\u6B63\u786E"
    );
  }
}
function formula(ctx) {
  const resultField = str(ctx.params, "resultField");
  const expression = ctx.params.expression;
  if (resultField === "" || typeof expression !== "object" || expression === null || Array.isArray(expression)) {
    ctx.skip("\u89C4\u5219\u5E93\u672A\u914D\u7F6E resultField \u6216 expression\uFF0C\u672C\u6761\u4E0D\u6267\u884C");
    return;
  }
  const spec = expression;
  const op = typeof spec.op === "string" ? spec.op : "";
  const fields = Array.isArray(spec.fields) ? spec.fields.filter((entry) => typeof entry === "string") : [];
  const scale = typeof spec.scale === "number" && Number.isFinite(spec.scale) ? spec.scale : 1;
  const signs = Array.isArray(spec.signs) ? spec.signs.map((entry) => entry === -1 || entry === "-1" || entry === "-" ? -1 : 1) : [];
  if (fields.length === 0 || !["divide", "product", "sum", "subtract", "percent"].includes(op)) {
    ctx.skip("\u89C4\u5219\u5E93\u914D\u7F6E\u7684 expression \u4E0D\u5B8C\u6574\uFF1Aop \u5E94\u4E3A divide/product/sum/subtract/percent\uFF0C\u4E14\u9700\u7ED9\u51FA fields");
    return;
  }
  const usable = ctx.input.rows.filter(
    (row) => filled(valueOf(ctx.input, row, resultField)) && fields.every((field) => filled(valueOf(ctx.input, row, field)))
  );
  if (usable.length === 0) {
    ctx.skip(`\u6750\u6599\u6CA1\u6709\u540C\u65F6\u586B\u5199\u300C${resultField}\u300D\u4E0E ${fields.join("\u3001")} \u7684\u884C\uFF0C\u65E0\u6CD5\u6838\u5BF9\u8868\u8FBE\u5F0F`);
    return;
  }
  const headerUsable = fields.every((field) => filled(ctx.input.header[field]));
  if (usable.length === 0 && !headerUsable) {
    ctx.skip(`\u6750\u6599\u6CA1\u6709\u540C\u65F6\u586B\u5199\u300C${resultField}\u300D\u4E0E ${fields.join("\u3001")} \u7684\u884C\uFF0C\u65E0\u6CD5\u6838\u5BF9\u8868\u8FBE\u5F0F`);
    return;
  }
  const tolerance = optionalNumber(ctx.params, "tolerance") ?? 0;
  const label = {
    divide: fields.join(" \xF7 "),
    product: fields.join(" \xD7 "),
    sum: fields.map((field, index) => `${signs[index] === -1 ? "\u2212" : index === 0 ? "" : "+"}${field}`).join(" "),
    subtract: `${fields[0]} \u2212 ${fields.slice(1).join(" \u2212 ")}`,
    percent: `${fields.join(" \xF7 ")} \xD7 100`
  };
  const round = (value) => Number(value.toFixed(6));
  for (const row of usable) {
    const declared = numberOf(valueOf(ctx.input, row, resultField));
    const values = fields.map((field) => numberOf(valueOf(ctx.input, row, field)));
    if (declared === void 0 || values.some((value) => value === void 0)) {
      ctx.add(
        locatorOf(row.row, resultField),
        `\u7B2C ${row.row} \u884C\u7684\u300C${resultField}\u300D\u6216 ${fields.join("\u3001")} \u4E2D\u6709\u65E0\u6CD5\u89E3\u6790\u4E3A\u6570\u503C\u7684\u503C`,
        `\u300C${resultField}\u300D\u5E94\u7B49\u4E8E ${label[op] ?? op}`,
        "\u6838\u5BF9\u586B\u5199\u5F62\u5F0F\uFF1B\u672C\u6761\u53EA\u505A\u7B97\u672F\u6838\u5BF9"
      );
      continue;
    }
    const numbers2 = values;
    const first2 = numbers2[0];
    const rest2 = numbers2.slice(1);
    let expected;
    switch (op) {
      case "divide":
        expected = rest2.reduce((total, value) => total / value, first2);
        break;
      case "product":
        expected = numbers2.reduce((total, value) => total * value, 1);
        break;
      case "sum":
        expected = numbers2.reduce((total, value, index) => total + (signs[index] ?? 1) * value, 0);
        break;
      case "subtract":
        expected = rest2.reduce((total, value) => total - value, first2);
        break;
      default:
        expected = first2 / (rest2[0] ?? 1) * 100;
        break;
    }
    expected *= scale;
    if (Math.abs(declared - expected) <= tolerance) continue;
    ctx.add(
      locatorOf(row.row, resultField),
      `\u7B2C ${row.row} \u884C\u300C${resultField}\u300D\u586B\u62A5 ${declared}\uFF0C\u6309 ${label[op] ?? op} \u5E94\u4E3A ${round(expected)}`,
      `\u300C${resultField}\u300D\u5E94\u7B49\u4E8E ${label[op] ?? op}`,
      str(ctx.params, "fix", "\u6838\u5BF9\u53D6\u6570\u4E0E\u8BA1\u7B97\u53E3\u5F84\uFF1B\u672C\u6761\u53EA\u505A\u7B97\u672F\u6838\u5BF9\uFF0C\u4E0D\u5224\u65AD\u53D6\u6570\u672C\u8EAB\u662F\u5426\u6070\u5F53")
    );
  }
  if (usable.length > 0 || !headerUsable) return;
  const headerDeclared = numberOf(valueOf(ctx.input, {}, resultField)) ?? numberOf(ctx.input.header[resultField]);
  const headerValues = fields.map((field) => numberOf(ctx.input.header[field]));
  if (headerDeclared === void 0 || headerValues.some((value) => value === void 0)) {
    ctx.skip(`\u6750\u6599\u8868\u5934\u7684\u300C${resultField}\u300D\u6216 ${fields.join("\u3001")} \u65E0\u6CD5\u89E3\u6790\u4E3A\u6570\u503C\uFF0C\u65E0\u6CD5\u6838\u5BF9\u8868\u8FBE\u5F0F`);
    return;
  }
  const numbers = headerValues;
  const first = numbers[0];
  const rest = numbers.slice(1);
  let expectedHeader;
  switch (op) {
    case "divide":
      expectedHeader = rest.reduce((total, value) => total / value, first);
      break;
    case "product":
      expectedHeader = numbers.reduce((total, value) => total * value, 1);
      break;
    case "sum":
      expectedHeader = numbers.reduce((total, value, index) => total + (signs[index] ?? 1) * value, 0);
      break;
    case "subtract":
      expectedHeader = rest.reduce((total, value) => total - value, first);
      break;
    default:
      expectedHeader = first / (rest[0] ?? 1) * 100;
      break;
  }
  expectedHeader *= scale;
  if (Math.abs(headerDeclared - expectedHeader) <= tolerance) return;
  ctx.add(
    locatorOf(void 0, resultField),
    `\u6750\u6599\u8868\u5934\u300C${resultField}\u300D\u4E3A ${headerDeclared}\uFF0C\u6309 ${label[op] ?? op} \u5E94\u4E3A ${round(expectedHeader)}`,
    `\u8868\u5934\u300C${resultField}\u300D\u5E94\u7B49\u4E8E ${label[op] ?? op}`,
    str(ctx.params, "fix", "\u6838\u5BF9\u53D6\u6570\u4E0E\u8BA1\u7B97\u53E3\u5F84\uFF1B\u672C\u6761\u53EA\u505A\u7B97\u672F\u6838\u5BF9\uFF0C\u4E0D\u5224\u65AD\u53D6\u6570\u672C\u8EAB\u662F\u5426\u6070\u5F53")
  );
}
function capabilityIndex(ctx) {
  const cpField = str(ctx.params, "cpField");
  const cpkField = str(ctx.params, "cpkField");
  const uslField = str(ctx.params, "uslField");
  const lslField = str(ctx.params, "lslField");
  const stdDevField = str(ctx.params, "stdDevField");
  const meanField = str(ctx.params, "meanField");
  if ([cpField, cpkField, uslField, lslField, stdDevField, meanField].some((field) => field === "")) {
    ctx.skip("\u89C4\u5219\u5E93\u672A\u914D\u7F6E Cp/Cpk \u5B9A\u4E49\u5F0F\u6240\u9700\u7684\u5B57\u6BB5\u540D\uFF0C\u672C\u6761\u4E0D\u6267\u884C");
    return;
  }
  const tolerance = optionalNumber(ctx.params, "tolerance") ?? 0;
  const usable = ctx.input.rows.filter(
    (row) => (filled(valueOf(ctx.input, row, cpField)) || filled(valueOf(ctx.input, row, cpkField))) && filled(valueOf(ctx.input, row, uslField)) && filled(valueOf(ctx.input, row, lslField)) && filled(valueOf(ctx.input, row, stdDevField)) && filled(valueOf(ctx.input, row, meanField))
  );
  if (usable.length === 0) {
    ctx.skip(`\u6750\u6599\u6CA1\u6709\u540C\u65F6\u586B\u5199\u300C${uslField}\u300D\u300C${lslField}\u300D\u300C${stdDevField}\u300D\u300C${meanField}\u300D\u4E0E\u80FD\u529B\u6307\u6570\u7684\u884C\uFF0C\u65E0\u6CD5\u6838\u5BF9\u5B9A\u4E49\u5F0F`);
    return;
  }
  const round = (value) => Number(value.toFixed(4));
  for (const row of usable) {
    const usl = numberOf(valueOf(ctx.input, row, uslField));
    const lsl = numberOf(valueOf(ctx.input, row, lslField));
    const sigma = numberOf(valueOf(ctx.input, row, stdDevField));
    const mean = numberOf(valueOf(ctx.input, row, meanField));
    if (usl === void 0 || lsl === void 0 || sigma === void 0 || mean === void 0 || sigma <= 0) {
      ctx.add(
        locatorOf(row.row, cpkField),
        `\u7B2C ${row.row} \u884C\u7684\u89C4\u683C\u9650\u3001\u6807\u51C6\u5DEE\u6216\u5747\u503C\u65E0\u6CD5\u7528\u4E8E\u8BA1\u7B97\uFF08\u6807\u51C6\u5DEE\u987B\u5927\u4E8E\u96F6\uFF09`,
        `Cp \u4E0E Cpk \u5E94\u7531\u89C4\u683C\u9650\u3001\u5747\u503C\u4E0E\u6807\u51C6\u5DEE\u6309\u5B9A\u4E49\u5F0F\u7B97\u51FA`,
        "\u6838\u5BF9\u586B\u5199\u5F62\u5F0F\u4E0E\u6807\u51C6\u5DEE\u53D6\u503C"
      );
      continue;
    }
    const expectedCp = (usl - lsl) / (6 * sigma);
    const expectedCpk = Math.min(usl - mean, mean - lsl) / (3 * sigma);
    const actualCp = numberOf(valueOf(ctx.input, row, cpField));
    const actualCpk = numberOf(valueOf(ctx.input, row, cpkField));
    if (actualCp !== void 0 && Math.abs(actualCp - expectedCp) > tolerance) {
      ctx.add(
        locatorOf(row.row, cpField),
        `\u7B2C ${row.row} \u884C Cp \u586B\u62A5 ${actualCp}\uFF0C\u6309 (${usl} \u2212 ${lsl}) / (6 \xD7 ${sigma}) \u5E94\u4E3A ${round(expectedCp)}`,
        "Cp = (USL \u2212 LSL) / 6\u03C3",
        "\u6838\u5BF9\u6807\u51C6\u5DEE\u53E3\u5F84\uFF1ACp/Cpk \u7528\u7EC4\u5185\u6807\u51C6\u5DEE\uFF0CPp/Ppk \u7528\u603B\u4F53\u6807\u51C6\u5DEE\uFF1B\u672C\u6761\u53EA\u505A\u7B97\u672F\u6838\u5BF9"
      );
      continue;
    }
    if (actualCpk === void 0 || Math.abs(actualCpk - expectedCpk) <= tolerance) continue;
    ctx.add(
      locatorOf(row.row, cpkField),
      `\u7B2C ${row.row} \u884C Cpk \u586B\u62A5 ${actualCpk}\uFF0C\u6309 min(USL \u2212 X\u0304, X\u0304 \u2212 LSL) / 3\u03C3 \u5E94\u4E3A ${round(expectedCpk)}`,
      "Cpk = min(USL \u2212 X\u0304, X\u0304 \u2212 LSL) / 3\u03C3",
      "\u6838\u5BF9\u6807\u51C6\u5DEE\u53E3\u5F84\u4E0E\u5747\u503C\uFF1B\u672C\u6761\u53EA\u505A\u7B97\u672F\u6838\u5BF9\uFF0C\u4E0D\u5224\u65AD\u80FD\u529B\u662F\u5426\u8DB3\u591F"
    );
  }
}
function controlLimits(ctx) {
  const centerField = str(ctx.params, "centerField");
  const rangeField = str(ctx.params, "rangeField");
  const uclField = str(ctx.params, "uclField");
  const lclField = str(ctx.params, "lclField");
  const sizeField = str(ctx.params, "sizeField");
  const rawTable = ctx.params.coefficients;
  if (uclField === "" || lclField === "" || centerField === "" && rangeField === "") {
    ctx.skip("\u89C4\u5219\u5E93\u672A\u914D\u7F6E centerField/rangeField \u6216\u63A7\u5236\u9650\u5B57\u6BB5\uFF0C\u672C\u6761\u4E0D\u6267\u884C");
    return;
  }
  if (typeof rawTable !== "object" || rawTable === null || Array.isArray(rawTable)) {
    ctx.skip("\u89C4\u5219\u5E93\u672A\u914D\u7F6E coefficients \u5E38\u6570\u8868\uFF1A\u63A7\u5236\u56FE\u7CFB\u6570\u968F\u56FE\u79CD\u53D8\u5316\uFF0C\u672C\u5F15\u64CE\u4E0D\u786C\u7F16\u7801");
    return;
  }
  const table = rawTable;
  const tolerance = optionalNumber(ctx.params, "tolerance") ?? 0;
  const usable = ctx.input.rows.filter(
    (row) => filled(valueOf(ctx.input, row, uclField)) && filled(valueOf(ctx.input, row, lclField))
  );
  if (usable.length === 0) {
    ctx.skip(`\u6750\u6599\u6CA1\u6709\u300C${uclField}\u300D\u4E0E\u300C${lclField}\u300D\uFF0C\u65E0\u6CD5\u6838\u5BF9\u63A7\u5236\u9650`);
    return;
  }
  let checked = 0;
  for (const row of usable) {
    const key = sizeField === "" ? "" : (valueOf(ctx.input, row, sizeField) ?? "").trim();
    const entry = table[key];
    const coefficients = typeof entry === "object" && entry !== null && !Array.isArray(entry) ? entry : void 0;
    if (coefficients === void 0) {
      ctx.add(
        locatorOf(row.row, uclField),
        `\u7B2C ${row.row} \u884C\u7684\u5B50\u7EC4\u5927\u5C0F\u300C${key === "" ? "\uFF08\u672A\u586B\uFF09" : key}\u300D\u5728\u5E38\u6570\u8868\u4E2D\u6CA1\u6709\u5BF9\u5E94\u6863\u4F4D`,
        "\u5B50\u7EC4\u5927\u5C0F\u5E94\u4E3A\u5E38\u6570\u8868\u8986\u76D6\u7684\u6863\u4F4D\u4E4B\u4E00",
        "\u8865\u9F50\u5B50\u7EC4\u5927\u5C0F\uFF0C\u6216\u628A\u8BE5\u6863\u4F4D\u7684\u7CFB\u6570\u52A0\u8FDB\u89C4\u5219\u7684 coefficients\uFF1B\u672C\u6761\u53EA\u6838\u5BF9\u6863\u4F4D\u662F\u5426\u5728\u518C"
      );
      continue;
    }
    const center = centerField === "" ? void 0 : numberOf(valueOf(ctx.input, row, centerField));
    const dispersion = rangeField === "" ? void 0 : numberOf(valueOf(ctx.input, row, rangeField));
    if (center === void 0 || dispersion === void 0) continue;
    checked += 1;
    const a2 = typeof coefficients.a2 === "number" ? coefficients.a2 : void 0;
    const d3 = typeof coefficients.d3 === "number" ? coefficients.d3 : 0;
    const d4 = typeof coefficients.d4 === "number" ? coefficients.d4 : 0;
    const expectedUcl = a2 !== void 0 ? center + a2 * dispersion : d4 * dispersion;
    const expectedLcl = a2 !== void 0 ? center - a2 * dispersion : d3 * dispersion;
    const actualUcl = numberOf(valueOf(ctx.input, row, uclField));
    const actualLcl = numberOf(valueOf(ctx.input, row, lclField));
    if (actualUcl === void 0 || actualLcl === void 0) {
      ctx.add(
        locatorOf(row.row, uclField),
        `\u7B2C ${row.row} \u884C\u7684\u63A7\u5236\u9650\u4E0D\u662F\u53EF\u89E3\u6790\u7684\u6570\u503C`,
        "\u63A7\u5236\u9650\u5E94\u4E3A\u6570\u503C",
        "\u6838\u5BF9\u586B\u5199\u5F62\u5F0F"
      );
      continue;
    }
    const round = (value) => Number(value.toFixed(6));
    if (Math.abs(actualUcl - expectedUcl) <= tolerance && Math.abs(actualLcl - expectedLcl) <= tolerance) continue;
    ctx.add(
      locatorOf(row.row, uclField),
      `\u7B2C ${row.row} \u884C\u63A7\u5236\u9650\u4E3A [${round(actualLcl)}, ${round(actualUcl)}]\uFF0C\u800C\u6309\u7CFB\u6570\u8868\u5E94\u4E3A [${round(expectedLcl)}, ${round(expectedUcl)}]`,
      `\u63A7\u5236\u9650\u5E94\u7B49\u4E8E\u4E2D\u5FC3\u7EBF\u4E0E\u7CFB\u6570\u3001\u6781\u5DEE\u7684\u7EC4\u5408\uFF08\u5B50\u7EC4\u5927\u5C0F ${key} \u5BF9\u5E94\u7CFB\u6570 ${JSON.stringify(coefficients)}\uFF09`,
      "\u6838\u5BF9\u5B50\u7EC4\u5927\u5C0F\u3001\u6781\u5DEE\u4E0E\u63A7\u5236\u9650\u7684\u53D6\u6570\uFF1B\u672C\u6761\u53EA\u6309\u914D\u7F6E\u7684\u7CFB\u6570\u8868\u505A\u7B97\u672F\u6838\u5BF9\uFF0C\u4E0D\u5224\u65AD\u8FC7\u7A0B\u662F\u5426\u53D7\u63A7"
    );
  }
  if (checked === 0) {
    ctx.skip(`\u6750\u6599\u7F3A\u5C11\u300C${centerField}\u300D\u6216\u300C${rangeField}\u300D\uFF0C\u65E0\u6CD5\u6838\u5BF9\u63A7\u5236\u9650\u4E0E\u7CFB\u6570\u7684\u4E00\u81F4\u6027`);
  }
}
function derivedDays(ctx) {
  const daysField = str(ctx.params, "daysField");
  const fromField = str(ctx.params, "fromField");
  const toField = str(ctx.params, "toField");
  const subtractField = str(ctx.params, "subtractField");
  if (daysField === "" || fromField === "" || toField === "") {
    ctx.skip("\u89C4\u5219\u5E93\u672A\u914D\u7F6E daysField\u3001fromField \u6216 toField\uFF0C\u672C\u6761\u4E0D\u6267\u884C");
    return;
  }
  const usable = ctx.input.rows.filter(
    (row) => filled(valueOf(ctx.input, row, daysField)) && filled(valueOf(ctx.input, row, fromField)) && filled(valueOf(ctx.input, row, toField)) && (subtractField === "" || filled(valueOf(ctx.input, row, subtractField)))
  );
  if (usable.length === 0) {
    ctx.skip(`\u6750\u6599\u6CA1\u6709\u540C\u65F6\u586B\u5199\u300C${daysField}\u300D\u4E0E\u8D77\u6B62\u65E5\u671F\u7684\u884C\uFF0C\u65E0\u6CD5\u6838\u5BF9\u5929\u6570`);
    return;
  }
  const tolerance = optionalNumber(ctx.params, "tolerance") ?? 0;
  for (const row of usable) {
    const declared = numberOf(valueOf(ctx.input, row, daysField));
    const from = parseWallClock(valueOf(ctx.input, row, fromField) ?? "");
    const to = parseWallClock(valueOf(ctx.input, row, toField) ?? "");
    const free = subtractField === "" ? 0 : numberOf(valueOf(ctx.input, row, subtractField));
    if (declared === void 0 || from === void 0 || to === void 0 || free === void 0) {
      ctx.add(
        locatorOf(row.row, daysField),
        `\u7B2C ${row.row} \u884C\u7684\u300C${daysField}\u300D\u6216\u8D77\u6B62\u65E5\u671F\u4E2D\u6709\u65E0\u6CD5\u89E3\u6790\u7684\u503C`,
        `\u300C${daysField}\u300D\u5E94\u7B49\u4E8E\u8D77\u6B62\u65E5\u671F\u4E4B\u5DEE${subtractField === "" ? "" : `\u51CF\u53BB\u300C${subtractField}\u300D`}`,
        "\u6838\u5BF9\u586B\u5199\u5F62\u5F0F\uFF1B\u672C\u6761\u53EA\u505A\u7B97\u672F\u6838\u5BF9"
      );
      continue;
    }
    const spanMinutes = diffMinutes(from, to);
    const derived = Math.max(0, spanMinutes / 1440 - free);
    const rounded = Number(derived.toFixed(6));
    if (Math.abs(rounded - declared) <= tolerance) continue;
    ctx.add(
      locatorOf(row.row, daysField),
      `\u7B2C ${row.row} \u884C\u300C${daysField}\u300D\u586B\u62A5 ${declared}\uFF0C\u6309\u300C${toField}\u300D${to.date}${to.hasTime ? ` ${to.time}` : ""} \u51CF\u300C${fromField}\u300D${from.date}${from.hasTime ? ` ${from.time}` : ""}${subtractField === "" ? "" : ` \u518D\u51CF\u300C${subtractField}\u300D`} \u5E94\u4E3A ${rounded} \u5929`,
      `\u300C${daysField}\u300D\u5E94\u7B49\u4E8E\u8D77\u6B62\u65F6\u523B\u4E4B\u5DEE${subtractField === "" ? "" : `\u51CF\u53BB\u300C${subtractField}\u300D`}\uFF0C\u5355\u4F4D\u4E3A\u5929`,
      "\u6838\u5BF9\u662F\u5426\u6284\u9519\u6216\u53E3\u5F84\u4E0D\u540C\uFF1B\u672C\u6761\u53EA\u505A\u7B97\u672F\u6838\u5BF9\uFF0C\u4E0D\u5224\u65AD\u8D77\u7B97\u53E3\u5F84\u662F\u5426\u6B63\u786E"
    );
  }
}
function sharedTerms(ctx) {
  const leftField = str(ctx.params, "leftField");
  const rightField = str(ctx.params, "rightField");
  const minShared = optionalNumber(ctx.params, "minShared") ?? 1;
  if (leftField === "" || rightField === "") {
    ctx.skip("\u89C4\u5219\u5E93\u672A\u914D\u7F6E leftField \u6216 rightField\uFF0C\u672C\u6761\u4E0D\u6267\u884C");
    return;
  }
  const usable = ctx.input.rows.filter(
    (row) => filled(valueOf(ctx.input, row, leftField)) && filled(valueOf(ctx.input, row, rightField))
  );
  if (usable.length === 0) {
    ctx.skip(`\u6750\u6599\u6CA1\u6709\u540C\u65F6\u586B\u5199\u300C${leftField}\u300D\u4E0E\u300C${rightField}\u300D\u7684\u884C\uFF0C\u672C\u6761\u4E0D\u9002\u7528`);
    return;
  }
  const terms = (text) => {
    const out = /* @__PURE__ */ new Set();
    for (const word of text.toLowerCase().match(/[a-z]+|\d+(?:\.\d+)?/g) ?? []) out.add(word);
    for (const run of text.match(/[\u4e00-\u9fff]+/g) ?? []) {
      if (run.length === 1) out.add(run);
      for (let index = 0; index + 1 < run.length; index += 1) out.add(run.slice(index, index + 2));
    }
    return out;
  };
  for (const row of usable) {
    const left = terms(valueOf(ctx.input, row, leftField) ?? "");
    const right = terms(valueOf(ctx.input, row, rightField) ?? "");
    if (left.size === 0 || right.size === 0) continue;
    let shared = 0;
    for (const term of right) if (left.has(term)) shared += 1;
    if (shared >= minShared) continue;
    ctx.add(
      locatorOf(row.row, rightField),
      `\u7B2C ${row.row} \u884C\u300C${rightField}\u300D\u4E0E\u300C${leftField}\u300D\u6CA1\u6709\u5171\u540C\u8BCD\uFF08\u5171\u540C\u8BCD ${shared} \u4E2A\uFF0C\u914D\u7F6E\u4E0B\u9650 ${minShared} \u4E2A\uFF09`,
      `\u300C${rightField}\u300D\u5E94\u4E0E\u300C${leftField}\u300D\u5728\u5B57\u9762\u4E0A\u76F8\u5173`,
      str(
        ctx.params,
        "fix",
        "\u672C\u6761\u53EA\u63D0\u793A\u4E24\u680F\u770B\u4E0D\u51FA\u5173\u7CFB\u3001\u503C\u5F97\u4EBA\u5DE5\u590D\u6838\uFF0C\u4E0D\u65AD\u8A00\u63D0\u70BC\u6709\u8BEF\uFF1B\u540C\u4E49\u6539\u5199\u4F1A\u62C9\u4F4E\u5171\u540C\u8BCD\u6570\uFF0C\u53EF\u8C03\u6574 minShared"
      )
    );
  }
}
function versionToken(raw) {
  if (raw === void 0) return void 0;
  const match = /(?:^|[\s(（[【])(?:版本|版次|rev(?:ision)?|ver(?:sion)?|v)\s*[:：]?\s*([A-Za-z]?\d+(?:\.\d+)?)\s*(?:版)?\s*$/i.exec(
    raw.trim()
  );
  return match?.[1];
}
function referenceVersion(ctx) {
  const referenceField = str(ctx.params, "referenceField");
  const sameVersionField = str(ctx.params, "sameVersionField");
  const actualCandidates = stringList(ctx.params, "actualVersionField", "actualVersionField");
  if (referenceField === "") {
    ctx.skip("\u89C4\u5219\u5E93\u672A\u914D\u7F6E referenceField\uFF0C\u672C\u6761\u4E0D\u6267\u884C");
    return;
  }
  if (sameVersionField === "" && actualCandidates.length === 0) {
    ctx.skip("\u89C4\u5219\u5E93\u672A\u914D\u7F6E sameVersionField \u6216 actualVersionField\uFF0C\u672C\u6761\u4E0D\u6267\u884C");
    return;
  }
  const usable = ctx.input.rows.filter((row) => filled(row.fields[referenceField]));
  if (usable.length === 0) {
    ctx.skip(`\u6750\u6599\u6CA1\u6709\u300C${referenceField}\u300D\u5217\u6216\u8BE5\u5217\u5168\u4E3A\u7A7A\uFF0C\u65E0\u6CD5\u6838\u5BF9\u5F15\u7528\u7248\u672C`);
    return;
  }
  const currentVersion = (row) => {
    for (const candidate of actualCandidates) {
      const value = (row.fields[candidate] ?? "").trim();
      if (value !== "") return versionToken(value) ?? value;
    }
    for (const candidate of actualCandidates) {
      const value = (ctx.input.header[candidate] ?? "").trim();
      if (value !== "") return versionToken(value) ?? value;
    }
    return "";
  };
  const strip = (value) => value.replace(/^[vV]/, "").trim().toLowerCase();
  let compared = 0;
  for (const row of usable) {
    const expected = currentVersion(row);
    const declared = sameVersionField === "" ? versionToken(row.fields[referenceField]) : (row.fields[sameVersionField] ?? "").trim();
    if (declared === void 0 || declared === "" || expected === "") {
      ctx.add(
        locatorOf(row.row, referenceField),
        `\u7B2C ${row.row} \u884C\u5F15\u7528\u4E86\u300C${row.fields[referenceField]}\u300D\uFF0C\u4F46\u65E0\u6CD5\u786E\u5B9A\u5176\u7248\u672C\u6216\u6587\u4EF6\u7684\u73B0\u884C\u7248\u672C`,
        "\u5F15\u7528\u4E2D\u5E94\u80FD\u770B\u6E05\u7248\u672C\uFF0C\u4E14\u6587\u4EF6\u5E94\u6709\u53EF\u6BD4\u7684\u73B0\u884C\u7248\u672C",
        "\u628A\u5F15\u7528\u7248\u672C\u5355\u5217\u4E00\u680F\uFF08sameVersionField\uFF09\uFF0C\u6216\u5728\u8868\u5934\u63D0\u4F9B\u6587\u4EF6\u5B9E\u9645\u7248\u672C\uFF1B\u672C\u6761\u53EA\u505A\u7248\u672C\u4E32\u6BD4\u5BF9"
      );
      continue;
    }
    compared += 1;
    if (strip(declared) === strip(expected)) continue;
    ctx.add(
      locatorOf(row.row, referenceField),
      `\u7B2C ${row.row} \u884C\u5F15\u7528\u7684\u7248\u672C\u300C${declared}\u300D\u4E0E\u6587\u4EF6\u73B0\u884C\u7248\u672C\u300C${expected}\u300D\u4E0D\u4E00\u81F4`,
      "\u5F15\u7528\u7684\u7248\u672C\u5E94\u4E0E\u8BE5\u6587\u4EF6\u7684\u73B0\u884C\u7248\u672C\u4E00\u81F4",
      "\u6838\u5BF9\u662F\u5426\u8FD8\u505C\u5728\u4E0A\u4E00\u7248\uFF1B\u672C\u6761\u53EA\u6BD4\u5BF9\u7248\u672C\u4E32\uFF0C\u4E0D\u5224\u65AD\u8BE5\u5F15\u7528\u5E94\u5F53\u6307\u5411\u54EA\u4E00\u7248"
    );
  }
  if (compared === 0) {
    ctx.skip(`\u6750\u6599\u4E2D\u7684\u300C${referenceField}\u300D\u65E2\u6CA1\u6709\u5355\u72EC\u7684\u7248\u672C\u680F\uFF0C\u4E5F\u6CA1\u6709\u53EF\u8BC6\u522B\u7684\u7248\u672C\u4E32\uFF0C\u65E0\u6CD5\u6838\u5BF9\u5F15\u7528\u7248\u672C`);
  }
}
function sameVersionWithinGroup(ctx) {
  const groupField = str(ctx.params, "groupField");
  const versionField = str(ctx.params, "versionField");
  if (groupField === "" || versionField === "") {
    ctx.skip("\u89C4\u5219\u5E93\u672A\u914D\u7F6E groupField \u6216 versionField\uFF0C\u672C\u6761\u4E0D\u6267\u884C");
    return;
  }
  const groups = /* @__PURE__ */ new Map();
  for (const row of ctx.input.rows) {
    const group = (valueOf(ctx.input, row, groupField) ?? "").trim();
    const version = (valueOf(ctx.input, row, versionField) ?? "").trim();
    if (group === "" || version === "") continue;
    const bucket = groups.get(group);
    if (bucket === void 0) groups.set(group, [{ version, row }]);
    else bucket.push({ version, row });
  }
  if (groups.size === 0) {
    ctx.skip(`\u6750\u6599\u6CA1\u6709\u540C\u65F6\u586B\u5199\u300C${groupField}\u300D\u4E0E\u300C${versionField}\u300D\u7684\u884C\uFF0C\u672C\u6761\u4E0D\u9002\u7528`);
    return;
  }
  const withSeveral = [...groups.entries()].filter(([, entries]) => entries.length > 1);
  if (withSeveral.length === 0) {
    ctx.skip(`\u6750\u6599\u4E2D\u6CA1\u6709\u300C${groupField}\u300D\u51FA\u73B0\u591A\u884C\u7684\u60C5\u51B5\uFF0C\u65E0\u6CD5\u6838\u5BF9\u7248\u672C\u662F\u5426\u4E00\u81F4`);
    return;
  }
  for (const [group, entries] of withSeveral) {
    const versions = [...new Set(entries.map((entry) => entry.version))];
    if (versions.length <= 1) continue;
    const first = entries[0];
    ctx.add(
      locatorOf(first.row.row, versionField),
      `\u300C${groupField}\u300D\u4E3A\u300C${group}\u300D\u7684\u884C\u58F0\u660E\u4E86 ${versions.length} \u4E2A\u4E0D\u540C\u7248\u672C\uFF1A${versions.join(" / ")}`,
      "\u540C\u4E00\u4EFD\u53D7\u63A7\u6587\u4EF6\u5728\u540C\u4E00\u53F0\u8D26\u5185\u5E94\u53EA\u6709\u4E00\u4E2A\u7248\u672C",
      "\u6838\u5BF9\u662F\u5426\u8BE5\u6587\u4EF6\u53EA\u88AB\u90E8\u5206\u4FEE\u8BA2\uFF08\u7248\u672C\u672A\u540C\u6B65\uFF09\uFF0C\u6216\u7248\u672C\u680F\u586B\u5199\u6709\u8BEF"
    );
  }
}
function monotonicSequence(ctx) {
  const field = str(ctx.params, "field");
  const order = stringList(ctx.params, "order", "order");
  if (field === "") {
    ctx.skip("\u89C4\u5219\u5E93\u672A\u914D\u7F6E field\uFF0C\u672C\u6761\u4E0D\u6267\u884C");
    return;
  }
  if (order.length === 0) {
    ctx.skip("\u89C4\u5219\u5E93\u672A\u914D\u7F6E order\uFF1A\u73AF\u8282\u6E05\u5355\u4E0E\u987A\u5E8F\u7531\u672C\u673A\u6784\u7BA1\u7406\u529E\u6CD5\u89C4\u5B9A\uFF0C\u672C\u5F15\u64CE\u4E0D\u786C\u7F16\u7801");
    return;
  }
  const rankOf = (value) => {
    const trimmed = value.trim();
    const exact = order.indexOf(trimmed);
    if (exact >= 0) return exact;
    return order.findIndex((candidate) => trimmed.startsWith(candidate));
  };
  const seen = [];
  for (const row of ctx.input.rows) {
    const value = (valueOf(ctx.input, row, field) ?? "").trim();
    if (value === "") continue;
    const rank = rankOf(value);
    if (rank < 0) {
      ctx.add(
        locatorOf(row.row, field),
        `\u7B2C ${row.row} \u884C\u300C${field}\u300D\u4E3A\u300C${value}\u300D\uFF0C\u4E0D\u5728\u672C\u673A\u6784\u914D\u7F6E\u7684\u987A\u5E8F\u8868\u4E2D`,
        `\u300C${field}\u300D\u5E94\u4E3A\u987A\u5E8F\u8868\u4E2D\u7684\u73AF\u8282\u4E4B\u4E00\uFF1A${order.join(" \u2192 ")}`,
        "\u6838\u5BF9\u8BE5\u73AF\u8282\u540D\u79F0\uFF0C\u6216\u628A\u672C\u673A\u6784\u7684\u73AF\u8282\u8865\u8FDB\u987A\u5E8F\u8868\uFF1B\u672C\u6761\u53EA\u6309\u914D\u7F6E\u7684\u987A\u5E8F\u8868\u6838\u5BF9"
      );
      continue;
    }
    seen.push({ row: row.row, value, rank });
  }
  if (seen.length === 0) {
    ctx.skip(`\u6750\u6599\u6CA1\u6709\u53EF\u8BC6\u522B\u7684\u300C${field}\u300D\u503C\uFF0C\u672C\u6761\u4E0D\u9002\u7528`);
    return;
  }
  for (let index = 1; index < seen.length; index += 1) {
    const previous = seen[index - 1];
    const current = seen[index];
    if (current.rank >= previous.rank) continue;
    ctx.add(
      locatorOf(current.row, field),
      `\u7B2C ${current.row} \u884C\u300C${field}\u300D\u4E3A\u300C${current.value}\u300D\uFF0C\u51FA\u73B0\u5728\u7B2C ${previous.row} \u884C\u7684\u300C${previous.value}\u300D\u4E4B\u540E\uFF0C\u4E0E\u914D\u7F6E\u987A\u5E8F\u76F8\u53CD`,
      `\u53F0\u8D26\u5E94\u6309 ${order.join(" \u2192 ")} \u7684\u987A\u5E8F\u767B\u8BB0`,
      "\u6838\u5BF9\u662F\u5426\u6F0F\u767B\u8BB0\u4E86\u4E2D\u95F4\u73AF\u8282\uFF0C\u6216\u4E24\u884C\u7684\u987A\u5E8F\u586B\u53CD\uFF1B\u672C\u6761\u53EA\u6309\u914D\u7F6E\u7684\u987A\u5E8F\u8868\u6838\u5BF9"
    );
  }
}
function prefixOf(ctx) {
  const field = str(ctx.params, "field");
  const components = stringList(ctx.params, "components", "components");
  const digits = optionalNumber(ctx.params, "digits");
  if (field === "" || components.length === 0) {
    ctx.skip("\u89C4\u5219\u5E93\u672A\u914D\u7F6E field \u6216 components\uFF0C\u672C\u6761\u4E0D\u6267\u884C");
    return;
  }
  const usable = ctx.input.rows.filter((row) => filled(row.fields[field]));
  if (usable.length === 0) {
    ctx.skip(`\u6750\u6599\u6CA1\u6709\u300C${field}\u300D\u5217\uFF0C\u672C\u6761\u4E0D\u9002\u7528`);
    return;
  }
  for (const row of usable) {
    const code = (valueOf(ctx.input, row, field) ?? "").replace(/\s/g, "");
    if (digits !== void 0 && digits > 0 && code.length !== digits) {
      ctx.add(
        locatorOf(row.row, field),
        `\u7B2C ${row.row} \u884C\u300C${field}\u300D\u4E3A\u300C${code}\u300D\uFF0C\u5171 ${code.length} \u4F4D\uFF0C\u4E0D\u662F ${digits} \u4F4D`,
        `\u300C${field}\u300D\u5E94\u4E3A ${digits} \u4F4D\u6570\u5B57`,
        "\u6838\u5BF9\u4F4D\u6570\uFF1B\u672C\u6761\u53EA\u6838\u5BF9\u5C42\u7EA7\u7ED3\u6784\uFF0C\u4E0D\u5224\u65AD\u5F52\u7C7B\u662F\u5426\u6B63\u786E"
      );
      continue;
    }
    let previousLength = 0;
    let broken = false;
    for (const component of components) {
      const stated = (valueOf(ctx.input, row, component) ?? "").replace(/\s/g, "");
      if (stated === "") continue;
      if (!code.startsWith(stated)) {
        ctx.add(
          locatorOf(row.row, component),
          `\u7B2C ${row.row} \u884C\u300C${component}\u300D\u4E3A\u300C${stated}\u300D\uFF0C\u4E0D\u662F\u300C${field}\u300D\uFF08${code}\uFF09\u7684\u524D\u7F00`,
          `\u300C${component}\u300D\u5E94\u4E0E\u300C${field}\u300D\u7684\u524D\u51E0\u4F4D\u4E00\u81F4`,
          "\u6838\u5BF9\u5C42\u7EA7\u586B\u5199\uFF1B\u672C\u6761\u53EA\u6838\u5BF9\u524D\u7F00\u5173\u7CFB\uFF0C\u4E0D\u5224\u65AD\u5F52\u7C7B\u662F\u5426\u6B63\u786E"
        );
        broken = true;
        break;
      }
      if (stated.length <= previousLength) {
        ctx.add(
          locatorOf(row.row, component),
          `\u7B2C ${row.row} \u884C\u300C${component}\u300D\u4E3A\u300C${stated}\u300D\uFF0C\u4E0D\u6BD4\u4E0A\u4E00\u7EA7\u66F4\u7EC6\uFF08\u4E0A\u4E00\u7EA7 ${previousLength} \u4F4D\uFF09`,
          "\u5C42\u7EA7\u5E94\u7531\u7C97\u5230\u7EC6\u3001\u4F4D\u6570\u9012\u589E",
          "\u6838\u5BF9\u5C42\u7EA7\u586B\u5199\uFF1B\u672C\u6761\u53EA\u6838\u5BF9\u5C42\u7EA7\u987A\u5E8F\uFF0C\u4E0D\u5224\u65AD\u5F52\u7C7B\u662F\u5426\u6B63\u786E"
        );
        broken = true;
        break;
      }
      previousLength = stated.length;
    }
    if (broken) continue;
  }
}
function thresholdCompare(ctx) {
  const valueField = str(ctx.params, "valueField");
  const limitField = str(ctx.params, "limitField");
  const verdictField = str(ctx.params, "verdictField");
  const overValues = stringList(ctx.params, "overValues", "overValues");
  const atMostValues = stringList(ctx.params, "atMostValues", "atMostValues");
  if (valueField === "" || limitField === "" || verdictField === "") {
    ctx.skip("\u89C4\u5219\u5E93\u672A\u914D\u7F6E valueField\u3001limitField \u6216 verdictField\uFF0C\u672C\u6761\u4E0D\u6267\u884C");
    return;
  }
  if (overValues.length === 0 || atMostValues.length === 0) {
    ctx.skip("\u89C4\u5219\u5E93\u672A\u914D\u7F6E overValues \u6216 atMostValues\uFF1A\u5224\u5B9A\u53D6\u503C\u7531\u672C\u673A\u6784\u53E3\u5F84\u51B3\u5B9A\uFF0C\u672C\u5F15\u64CE\u4E0D\u786C\u7F16\u7801");
    return;
  }
  const tolerance = optionalNumber(ctx.params, "tolerance") ?? 0;
  const usable = ctx.input.rows.filter(
    (row) => filled(valueOf(ctx.input, row, valueField)) && filled(valueOf(ctx.input, row, limitField)) && filled(valueOf(ctx.input, row, verdictField))
  );
  if (usable.length === 0) {
    ctx.skip(`\u6750\u6599\u6CA1\u6709\u540C\u65F6\u586B\u5199\u300C${valueField}\u300D\u300C${limitField}\u300D\u4E0E\u300C${verdictField}\u300D\u7684\u884C\uFF0C\u672C\u6761\u4E0D\u9002\u7528`);
    return;
  }
  for (const row of usable) {
    const value = numberOf(valueOf(ctx.input, row, valueField));
    const limit = numberOf(valueOf(ctx.input, row, limitField));
    const verdict = (valueOf(ctx.input, row, verdictField) ?? "").trim();
    if (value === void 0 || limit === void 0) {
      ctx.add(
        locatorOf(row.row, valueField),
        `\u7B2C ${row.row} \u884C\u7684\u300C${valueField}\u300D\u6216\u300C${limitField}\u300D\u65E0\u6CD5\u89E3\u6790\u4E3A\u6570\u503C\uFF0C\u65E0\u6CD5\u4E0E\u5224\u5B9A\u6BD4\u5BF9`,
        "\u4E24\u4E2A\u6570\u5E94\u53EF\u89E3\u6790\uFF0C\u5224\u5B9A\u5E94\u4E0E\u5B83\u4EEC\u7684\u5927\u5C0F\u5173\u7CFB\u76F8\u7B26",
        "\u6838\u5BF9\u586B\u5199\u5F62\u5F0F\uFF1B\u672C\u6761\u53EA\u6BD4\u5BF9\u53F0\u8D26\u81EA\u5DF1\u5199\u7684\u9650\u503C"
      );
      continue;
    }
    const isOver = overValues.includes(verdict);
    const isAtMost = atMostValues.includes(verdict);
    if (!isOver && !isAtMost) {
      ctx.add(
        locatorOf(row.row, verdictField),
        `\u7B2C ${row.row} \u884C\u300C${verdictField}\u300D\u7684\u503C\u4E3A\u300C${verdict}\u300D\uFF0C\u4E0D\u5728\u914D\u7F6E\u7684\u5224\u5B9A\u53D6\u503C\u5185`,
        `\u300C${verdictField}\u300D\u5E94\u4E3A ${overValues.join(" / ")}\uFF08\u8D85\u6807\uFF09\u6216 ${atMostValues.join(" / ")}\uFF08\u672A\u8D85\u6807\uFF09\u4E4B\u4E00`,
        "\u8865\u9F50 overValues \u6216 atMostValues\uFF0C\u6216\u4FEE\u6B63\u8BE5\u680F\uFF1B\u672C\u6761\u53EA\u6838\u5BF9\u53D6\u503C\u662F\u5426\u5728\u518C"
      );
      continue;
    }
    const actuallyOver = value > limit + tolerance;
    if (actuallyOver === isOver) continue;
    ctx.add(
      locatorOf(row.row, verdictField),
      `\u7B2C ${row.row} \u884C\u300C${valueField}\u300D\u4E3A ${value}\u3001\u300C${limitField}\u300D\u4E3A ${limit}\uFF0C\u800C\u5224\u5B9A\u4E3A\u300C${verdict}\u300D`,
      actuallyOver ? `${value} \u8D85\u8FC7\u9650\u503C ${limit}\uFF0C\u5224\u5B9A\u5E94\u8868\u793A\u8D85\u6807` : `${value} \u672A\u8D85\u8FC7\u9650\u503C ${limit}\uFF0C\u5224\u5B9A\u5E94\u8868\u793A\u672A\u8D85\u6807`,
      "\u6838\u5BF9\u4E09\u4E2A\u6570\u503C\u4E0E\u5224\u5B9A\uFF1B\u672C\u6761\u53EA\u6309\u53F0\u8D26\u81EA\u5DF1\u5199\u7684\u9650\u503C\u6BD4\u8F83\uFF0C\u4E0D\u5224\u65AD\u8BE5\u9650\u503C\u662F\u5426\u53D6\u5BF9\u4E86\u6807\u51C6"
    );
  }
}
function dateGap(ctx) {
  const earlierField = str(ctx.params, "earlierField");
  const laterField = str(ctx.params, "laterField");
  const minDaysField = str(ctx.params, "minDaysField");
  const minDaysLiteral = optionalNumber(ctx.params, "minDays");
  if (earlierField === "" || laterField === "" || minDaysField === "" && minDaysLiteral === void 0) {
    ctx.skip("\u89C4\u5219\u5E93\u672A\u914D\u7F6E earlierField\u3001laterField \u4E0E minDays/minDaysField\uFF0C\u672C\u6761\u4E0D\u6267\u884C");
    return;
  }
  const usable = ctx.input.rows.filter(
    (row) => filled(valueOf(ctx.input, row, earlierField)) && filled(valueOf(ctx.input, row, laterField)) && (minDaysField === "" || filled(valueOf(ctx.input, row, minDaysField)))
  );
  if (usable.length === 0) {
    ctx.skip(
      `\u6750\u6599\u6CA1\u6709\u540C\u65F6\u586B\u5199\u300C${earlierField}\u300D\u300C${laterField}\u300D${minDaysField === "" ? "" : `\u300C${minDaysField}\u300D`} \u7684\u884C\uFF0C\u672C\u6761\u4E0D\u9002\u7528`
    );
    return;
  }
  let checked = 0;
  for (const row of usable) {
    const earlier = parseWallClock(valueOf(ctx.input, row, earlierField) ?? "");
    const later = parseWallClock(valueOf(ctx.input, row, laterField) ?? "");
    const required = minDaysField === "" ? minDaysLiteral : numberOf(valueOf(ctx.input, row, minDaysField));
    if (earlier === void 0 || later === void 0 || required === void 0) {
      ctx.add(
        locatorOf(row.row, laterField),
        `\u7B2C ${row.row} \u884C\u7684\u300C${earlierField}\u300D\u300C${laterField}\u300D\u6216\u300C${minDaysField}\u300D\u4E2D\u6709\u65E0\u6CD5\u89E3\u6790\u7684\u503C`,
        "\u4E24\u4E2A\u65E5\u671F\u5E94\u53EF\u89E3\u6790\uFF0C\u95F4\u9694\u5929\u6570\u5E94\u4E3A\u6570\u503C",
        "\u6838\u5BF9\u586B\u5199\u5F62\u5F0F\uFF1B\u672C\u6761\u53EA\u505A\u65E5\u671F\u95F4\u9694\u6838\u5BF9"
      );
      continue;
    }
    checked += 1;
    const gap = diffMinutes(earlier, later) / 1440;
    if (gap + 1e-9 >= required) continue;
    ctx.add(
      locatorOf(row.row, laterField),
      `\u7B2C ${row.row} \u884C\u300C${laterField}\u300D\u4E3A ${later.date}\uFF0C\u8DDD\u300C${earlierField}\u300D${earlier.date} \u53EA\u6709 ${Number(gap.toFixed(4))} \u5929\uFF0C\u5C11\u4E8E${minDaysField === "" ? "\u914D\u7F6E\u7684" : `\u300C${minDaysField}\u300D\u7684`} ${required} \u5929`,
      `\u300C${laterField}\u300D\u5E94\u4E0D\u65E9\u4E8E\u300C${earlierField}\u300D\u4E4B\u540E ${required} \u5929`,
      str(ctx.params, "fix", "\u6838\u5BF9\u4E09\u4E2A\u5B57\u6BB5\u7684\u586B\u5199\uFF1B\u672C\u6761\u53EA\u6309\u53F0\u8D26\u81EA\u5DF1\u5199\u7684\u95F4\u9694\u5929\u6570\u6838\u5BF9\uFF0C\u4E0D\u5224\u65AD\u8BE5\u5929\u6570\u662F\u5426\u6070\u5F53")
    );
  }
  if (checked === 0) {
    ctx.skip(
      `\u6750\u6599\u4E2D\u7684\u300C${earlierField}\u300D\u300C${laterField}\u300D${minDaysField === "" ? "" : `\u300C${minDaysField}\u300D`} \u6CA1\u6709\u53EF\u89E3\u6790\u7684\u7EC4\u5408\uFF0C\u65E0\u6CD5\u6838\u5BF9\u95F4\u9694`
    );
  }
}
function runOneCheck(ctx) {
  const kind = str(ctx.params, "kind");
  switch (kind) {
    case "presence":
      return presence(ctx);
    case "presenceAny":
      return presenceAny(ctx);
    case "enum":
      return enumCheck(ctx);
    case "pattern":
      return patternCheck(ctx);
    case "date":
      return dateCheck(ctx);
    case "noFutureDate":
      return noFutureDate(ctx);
    case "dataAge":
      return dataAge(ctx);
    case "number":
      return numberCheck(ctx);
    case "unique":
      return uniqueCheck(ctx);
    case "sequence":
      return sequenceCheck(ctx);
    case "sum":
      return sumCheck(ctx);
    case "sumToConstant":
      return sumToConstant(ctx);
    case "countPerGroup":
      return countPerGroup(ctx);
    case "textContains":
      return textContains(ctx);
    case "containsAny":
      return containsAny(ctx);
    case "length":
      return lengthCheck(ctx);
    case "minLength":
      return minLength(ctx);
    case "headerPresence":
      return headerPresence(ctx);
    case "headerEnum":
      return headerEnum(ctx);
    case "conditionalPresence":
      return conditionalPresence(ctx);
    case "highRiskEvidence":
      return highRiskEvidence(ctx);
    case "thresholdPresence":
      return thresholdPresence(ctx);
    case "thresholdBelow":
      return thresholdBelow(ctx);
    case "fieldComparison":
      return fieldComparison(ctx);
    case "intervalOrder":
      return intervalOrder(ctx);
    case "productOf":
      return productOf(ctx);
    case "formula":
      return formula(ctx);
    case "capabilityIndex":
      return capabilityIndex(ctx);
    case "controlLimits":
      return controlLimits(ctx);
    case "derivedDays":
      return derivedDays(ctx);
    case "sharedTerms":
      return sharedTerms(ctx);
    case "referenceVersion":
      return referenceVersion(ctx);
    case "sameVersionWithinGroup":
      return sameVersionWithinGroup(ctx);
    case "monotonicSequence":
      return monotonicSequence(ctx);
    case "prefixOf":
      return prefixOf(ctx);
    case "thresholdCompare":
      return thresholdCompare(ctx);
    case "dateGap":
      return dateGap(ctx);
    default:
      ctx.skip(
        kind === "" ? "\u89C4\u5219\u5E93\u672A\u914D\u7F6E check.kind\uFF0C\u672C\u6761\u4E0D\u6267\u884C" : `\u89C4\u5219\u5E93\u914D\u7F6E\u7684 check.kind\u300C${kind}\u300D\u4E0D\u662F\u672C\u5F15\u64CE\u652F\u6301\u7684\u68C0\u67E5\u7C7B\u578B\uFF0C\u672C\u6761\u4E0D\u6267\u884C`
      );
  }
}
function runChecks(input, ruleset2, options) {
  const issues = [];
  const reasons = /* @__PURE__ */ new Map();
  const fired = /* @__PURE__ */ new Set();
  const disabled = /* @__PURE__ */ new Set([...ruleset2.disabled, ...options.disabledRules]);
  const only = new Set(options.onlyRules);
  for (const rule of ruleset2.rules) {
    if (disabled.has(rule.id) || only.size > 0 && !only.has(rule.id)) continue;
    const declaredCheck = typeof rule.params.check === "object" && rule.params.check !== null && !Array.isArray(rule.params.check) ? rule.params.check : {};
    const check2 = { ...rule.params, ...declaredCheck };
    delete check2.check;
    const override = options.overrides?.[rule.id];
    if (override !== void 0) Object.assign(check2, override);
    delete check2.check;
    const ctx = {
      input,
      ruleId: rule.id,
      params: check2,
      options,
      add: (locator, found, expected, fix) => {
        const issue = {
          id: issueId(ruleset2.plugin, rule.id, locator),
          ruleId: rule.id,
          severity: rule.severity,
          locator,
          found,
          expected,
          basis: formatBasis(rule.basis, rule.alsoBasis ?? [])
        };
        if (fix !== void 0) issue.fix = fix;
        issues.push(issue);
        fired.add(rule.id);
      },
      skip: (reason) => {
        reasons.set(rule.id, reason);
      }
    };
    runOneCheck(ctx);
  }
  return { issues, fired, reasons };
}
function disabledAsSkipped(ruleset2, disabled, note) {
  const byId = new Map(ruleset2.rules.map((rule) => [rule.id, rule]));
  const out = [];
  for (const ruleId of disabled) {
    const rule = byId.get(ruleId);
    out.push({
      rule: rule === void 0 ? ruleId : rule.id,
      reason: note(rule === void 0 ? "\u914D\u7F6E\u4E2D\u7981\u7528\u4E86\u8BE5\u89C4\u5219\uFF0C\u4F46\u89C4\u5219\u5E93\u4E2D\u6CA1\u6709\u8FD9\u4E00\u6761" : "\u8BE5\u89C4\u5219\u5728\u5F53\u524D\u914D\u7F6E\u4E2D\u88AB\u7981\u7528")
    });
  }
  return out;
}
function runTableCheck(input, ruleset2, options) {
  const disabled = /* @__PURE__ */ new Set([...ruleset2.disabled, ...options.disabledRules]);
  const only = new Set(options.onlyRules);
  const { issues, fired, reasons } = runChecks(input, ruleset2, options);
  const withNote = (reason) => options.skipNotes === void 0 || options.skipNotes === "" ? reason : `${reason}\uFF1B${options.skipNotes}`;
  const skipped = disabledAsSkipped(ruleset2, [...disabled], withNote);
  const already = new Set(skipped.map((entry) => entry.rule));
  for (const [ruleId, reason] of reasons) {
    if (already.has(ruleId)) continue;
    if (disabled.has(ruleId) || only.size > 0 && !only.has(ruleId)) continue;
    skipped.push({ rule: ruleId, reason: withNote(reason) });
    already.add(ruleId);
  }
  if (only.size > 0) {
    const notSelected = ruleset2.rules.filter((rule) => !only.has(rule.id) && !disabled.has(rule.id));
    if (notSelected.length > 0) {
      skipped.push({
        rule: notSelected.map((rule) => rule.id).join(","),
        reason: withNote(`\u672C\u6B21\u8C03\u7528\u901A\u8FC7 only \u53C2\u6570\u628A\u6267\u884C\u8303\u56F4\u9650\u5236\u4E3A ${[...only].join(", ")}\uFF0C\u4E0A\u5217\u89C4\u5219\u672A\u6267\u884C`)
      });
    }
  }
  const summary = { error: 0, warn: 0, info: 0 };
  for (const issue of issues) summary[issue.severity] += 1;
  return {
    plugin: options.plugin,
    target: input.target,
    checkedAt: options.checkedAt,
    rulesetVersion: ruleset2.version,
    summary,
    issues,
    skipped
  };
}

// ../../mnt/d/Projects/dsh/checkers/dsh-customs-doc-check/src/model.ts
var COLUMNS = {
  docKind: ["\u5355\u8BC1\u79CD\u7C7B", "\u5355\u8BC1\u7C7B\u578B", "\u5355\u636E\u540D\u79F0", "docKind", "document"],
  docNo: ["\u5355\u8BC1\u7F16\u53F7", "\u7F16\u53F7", "\u53D1\u7968\u53F7", "\u5408\u540C\u53F7", "docNo", "number"],
  hsCode: ["\u5546\u54C1\u7F16\u53F7", "HS\u7F16\u7801", "\u7A0E\u5219\u53F7\u5217", "hsCode", "hs"],
  goodsName: ["\u5546\u54C1\u540D\u79F0", "\u54C1\u540D", "\u8D27\u540D", "goodsName", "goods"],
  quantity: ["\u6570\u91CF", "\u6210\u4EA4\u6570\u91CF", "quantity", "qty"],
  unit: ["\u5355\u4F4D", "\u8BA1\u91CF\u5355\u4F4D", "\u6210\u4EA4\u8BA1\u91CF\u5355\u4F4D", "unit"],
  unitPrice: ["\u5355\u4EF7", "\u6210\u4EA4\u5355\u4EF7", "unitPrice", "price"],
  amount: ["\u603B\u4EF7", "\u6210\u4EA4\u603B\u4EF7", "\u91D1\u989D", "amount", "total"],
  currency: ["\u5E01\u5236", "\u5E01\u79CD", "currency"],
  tradeTerms: ["\u6210\u4EA4\u65B9\u5F0F", "\u8D38\u6613\u672F\u8BED", "\u4EF7\u683C\u6761\u4EF6", "tradeTerms", "terms"],
  origin: ["\u539F\u4EA7\u56FD", "\u539F\u4EA7\u56FD\u5730\u533A", "\u8D77\u8FD0\u56FD", "origin"],
  destination: ["\u6700\u7EC8\u76EE\u7684\u56FD", "\u8FD0\u62B5\u56FD", "destination"],
  grossWeight: ["\u6BDB\u91CD", "grossWeight"],
  netWeight: ["\u51C0\u91CD", "netWeight"],
  packages: ["\u4EF6\u6570", "\u5305\u88C5\u4EF6\u6570", "packages"],
  declaredAt: ["\u7533\u62A5\u65E5\u671F", "\u65E5\u671F", "declaredAt", "date"],
  note: ["\u5907\u6CE8", "\u8BF4\u660E", "note", "remark"]
};
var SPEC = {
  rowKeys: ["rows", "items", "documents", "\u5355\u8BC1"],
  columns: COLUMNS,
  header: {
    declarationNo: ["declarationNo", "\u62A5\u5173\u5355\u53F7", "\u63D0\u8FD0\u5355\u53F7"],
    consignee: ["consignee", "\u5883\u5185\u6536\u8D27\u4EBA", "\u6536\u53D1\u8D27\u4EBA", "\u7ECF\u8425\u5355\u4F4D"],
    contractNo: ["contractNo", "\u5408\u540C\u53F7", "\u5408\u540C\u534F\u8BAE\u53F7"],
    invoiceNo: ["invoiceNo", "\u53D1\u7968\u53F7"],
    declaredAt: ["declaredAt", "\u7533\u62A5\u65E5\u671F"]
  }
};
var REQUIRE_ANY_OF = [
  "\u62A5\u5173\u5355\u53F7",
  "declarationNo",
  "\u5355\u8BC1\u7F16\u53F7",
  "docNo",
  "\u5546\u54C1\u7F16\u53F7",
  "hsCode",
  "\u5546\u54C1\u540D\u79F0",
  "goodsName"
];
function parseMaterial(source, target) {
  const table = parseTable(source, target, {
    ...SPEC,
    ...REQUIRE_ANY_OF === void 0 ? {} : { requireAnyOf: REQUIRE_ANY_OF }
  });
  for (const row of table.rows) canonicaliseRow(row, SPEC);
  return table;
}

// ../../mnt/d/Projects/dsh/checkers/dsh-customs-doc-check/rules/customs-doc-check.yaml
var customs_doc_check_default = `# \u62A5\u5173\u5355\u8BC1\u4E00\u81F4\u6027\u6838\u5BF9 \u89C4\u5219\u5E93
#
# \u89C4\u5219\u6570\u636E\u4E0E\u4EE3\u7801\u5206\u79BB\uFF1A\u66FF\u6362\u672C\u6587\u4EF6\u5373\u53EF\u5207\u6362\u89C4\u5219\u96C6\u7248\u672C\uFF0C\u65E0\u9700\u6539\u52A8 TypeScript\u3002
#
# \u6761\u6B3E\u5F15\u7528\u7EAA\u5F8B\uFF08\u7531 shared/ruleset.ts \u5F3A\u5236\u6821\u9A8C\uFF09\uFF1A
#   - \u6BCF\u6761\u89C4\u5219\u5FC5\u987B\u5199\u5168 document / number / clause / excerpt / kind / source\uFF0C
#     \u4E14 excerpt \u5FC5\u987B\u662F\u9010\u5B57\u6458\u5F55\uFF0C\u4E0D\u5F97\u6539\u5199\u3002
#   - kind: direct                       \u6761\u6B3E\u76F4\u63A5\u89C4\u5B9A\u4E86\u6240\u68C0\u67E5\u7684\u8981\u6C42
#   - kind: derived-from-principle       \u6761\u6B3E\u672A\u76F4\u63A5\u89C4\u5B9A\uFF0C\u4EC5\u80FD\u7531\u539F\u5219\u6027\u6761\u6B3E\u63A8\u8BBA\uFF08severity \u6700\u591A warn\uFF09
#   - kind: institutional-configuration \u9608\u503C\u51FA\u81EA\u672C\u673A\u6784\u914D\u7F6E\uFF08severity \u6700\u591A info\uFF09
#
# \u26A0\uFE0F\u26A0\uFE0F \u672C\u89C4\u5219\u5E93\u7684\u8BDA\u5B9E\u8BF4\u660E\uFF1A**excerpt \u4E00\u5F8B\u4E0D\u662F\u5F15\u6587\u3002**
#   \u672C\u63D2\u4EF6\u6838\u5BF9\u7684\u662F"\u62A5\u5173\u5355\u8BC1\u53F0\u8D26"\uFF08\u5408\u540C\uFF0F\u53D1\u7968\uFF0F\u88C5\u7BB1\u5355\uFF0F\u62A5\u5173\u5355\u7B49\uFF09\u4E4B\u95F4\u7684\u5B57\u6BB5\u4E00\u81F4\u6027\u3002
#   \u5176\u89C4\u8303\u8F7D\u4F53\u5305\u62EC\u300A\u4E2D\u534E\u4EBA\u6C11\u5171\u548C\u56FD\u6D77\u5173\u8FDB\u51FA\u53E3\u8D27\u7269\u62A5\u5173\u5355\u586B\u5236\u89C4\u8303\u300B\uFF08\u6D77\u5173\u603B\u7F72\u516C\u544A 2019 \u5E74\u7B2C 18 \u53F7\uFF09
#   \u4E0E\u300A\u4E2D\u534E\u4EBA\u6C11\u5171\u548C\u56FD\u6D77\u5173\u8FDB\u51FA\u53E3\u8D27\u7269\u7533\u62A5\u7BA1\u7406\u89C4\u5B9A\u300B\u3002
#   \u26A0\uFE0F **\u300A\u62A5\u5173\u5355\u586B\u5236\u89C4\u8303\u300B\u5168\u6587\u5DF2\u53D6\u5F97\u5E76\u9010\u6761\u6838\u5BF9**\uFF08\u56DB\u5341\u4E5D\u6761 + \u76F8\u5173\u7528\u8BED\u5B9A\u4E49\uFF0C
#   \u89C1 rules/evidence/clause-verification.md\uFF09\uFF0C\u6838\u5230\u7B2C\u4E09\u6761\uFF08\u5546\u54C1\u7F16\u53F7 10 \u4F4D\uFF09\u3001\u7B2C\u4E94\u6761\uFF0F\u7B2C\u516D\u6761
#   \uFF08\u65E5\u671F\u4E3A 8 \u4F4D\u6570\u5B57 YYYYMMDD\uFF0C\u4E14**\u7533\u62A5\u65E5\u671F\u5728\u7533\u62A5\u65F6\u514D\u4E88\u586B\u62A5**\uFF09\u3001\u7B2C\u4E09\u5341\u4E5D\u6761\uFF08\u5E01\u5236\u6309\u300A\u8D27\u5E01\u4EE3\u7801\u8868\u300B\uFF09\u3001
#   \u7B2C\u4E8C\u5341\u56DB\u81F3\u4E8C\u5341\u516D\u6761\uFF08\u4EF6\u6570\u3001\u6BDB\u91CD\u3001\u51C0\u91CD\uFF09\u3001\u7B2C\u4E09\u5341\u516B\u6761\uFF08\u603B\u4EF7\uFF09\u7B49\u6761\u6587\u3002
#   \u26A0\uFE0F **\u636E\u6B64\u66F4\u6B63\u4E86\u4E24\u5904\u8868\u8FF0**\uFF1A\u2460 \`CD-003\` \u7684"\u4E09\u4F4D\u5B57\u6BCD"**\u4E0D\u662F\u6761\u6587\u63AA\u8F9E**\uFF0C
#   \u800C\u662F\u300A\u8D27\u5E01\u4EE3\u7801\u8868\u300B\u7684\u5F62\u6001\uFF08\u8BE5\u4EE3\u7801\u8868\u672A\u53D6\u5F97\uFF09\uFF1B\u2461 \`CD-006\` \u5FC5\u987B\u5199\u660E
#   **\u7533\u62A5\u65E5\u671F\u5728\u7533\u62A5\u65F6\u514D\u4E88\u586B\u62A5**\uFF0C\u6545"\u6CA1\u586B"\u4E0D\u5E94\u62A5\u9519\u3002
#   \u26A0\uFE0F **\u53D1\u6587\u4E8B\u5B9E\uFF08\u5B98\u65B9\u516C\u544A\u6838\u5B9E\uFF09**\uFF1A\u6210\u6587\u65E5\u671F **2019-01-22**\uFF0C**\u81EA 2019-02-01 \u8D77\u6267\u884C\uFF0C
#   \u6D77\u5173\u603B\u7F72 2018 \u5E74\u7B2C 60 \u53F7\u516C\u544A\u540C\u65F6\u5E9F\u6B62**\uFF08\u5F15\u7528\u5373\u9519\uFF09\uFF1B
#   **\u300A\u8FDB\uFF08\u51FA\uFF09\u5883\u8D27\u7269\u5907\u6848\u6E05\u5355\u300B\u6BD4\u7167\u672C\u89C4\u8303\u586B\u5236**\u3002\u89C4\u8303\u539F\u6587\u8BFB\u53D6\u7684\u662F
#   **\u5730\u65B9\u8D38\u4FC3\u4F1A\u7F51\u7AD9\u7684\u8F6C\u8F7D**\uFF08\u5B98\u65B9\u9644\u4EF6\u4E3A \`.doc\`\uFF0C\u6293\u53D6\u5DE5\u5177\u4E0D\u652F\u6301\u4E8C\u8FDB\u5236 Office \u6587\u6863\uFF09\u3002
#   \u26A0\uFE0F **\u300A\u7533\u62A5\u7BA1\u7406\u89C4\u5B9A\u300B\u4E0E\u5404\u7C7B\u4EE3\u7801\u8868\uFF08\u5173\u533A\u3001\u8FD0\u8F93\u65B9\u5F0F\u3001\u76D1\u7BA1\u65B9\u5F0F\u3001\u8D27\u5E01\u3001\u56FD\u522B\u3001\u6E2F\u53E3\u7B49\uFF09\u672C\u6B21\u5747\u672A\u53D6\u5F97**\uFF0C
#   \u8FD9\u6B63\u662F\u672C\u63D2\u4EF6**\u4E0D\u5185\u7F6E\u4EFB\u4F55\u4EE3\u7801\u8868**\u7684\u539F\u56E0\u3002
#   \u6BCF\u6761\u89C4\u5219\u7684 excerpt \u90FD\u5199\u660E"\u8BE5\u6761\u6587\u672C\u6B21\u672A\u53D6\u5F97"\uFF08\u56E0\u6838\u5BF9\u5BF9\u8C61\u662F\u53F0\u8D26\u800C\u975E\u62A5\u5173\u5355\uFF0C
#   \u8BE6\u89C1 evidence \u62A5\u544A\u7B2C\u4E94\u8282\uFF09\uFF0Ckind \u4FDD\u6301 derived-from-principle\uFF08\u5C01\u9876 warn\uFF09\u3002
#   \u672C\u63D2\u4EF6\u7684\u547D\u4E2D\u4FE1\u606F\u53EA\u5E94\u88AB\u8BFB\u4F5C"\u8FD9\u4E00\u680F\u6CA1\u586B / \u8FD9\u4E24\u4E2A\u7F16\u7801\u683C\u5F0F\u4E0D\u5BF9 / \u540C\u4E00\u5355\u53F7\u51FA\u73B0\u4E24\u6B21"\uFF0C
#   \u800C**\u4E0D\u662F**"\u7533\u62A5\u4E0D\u5B9E"\u6216"\u8FDD\u53CD\u4E86\u67D0\u6761\u89C4\u5B9A"\u3002
#
# \u26A0\uFE0F\u26A0\uFE0F \u53E6\u4E00\u6761**\u5FC5\u987B\u4FDD\u7559**\u7684\u8FB9\u754C\uFF1A**\u672C\u63D2\u4EF6\u7EDD\u4E0D\u5224\u5B9A\u7533\u62A5\u662F\u5426\u771F\u5B9E\u3001\u662F\u5426\u6784\u6210\u7533\u62A5\u4E0D\u5B9E\u3001
#   \u662F\u5426\u5F71\u54CD\u7A0E\u6B3E\u5F81\u6536\u3001\u662F\u5426\u5E94\u5F53\u67E5\u9A8C\u6216\u5904\u7F5A**\u3002\u90A3\u9700\u8981\u6D77\u5173\u4F9D\u6CD5\u5B9A\u804C\u6743\u5224\u65AD\uFF0C
#   \u800C\u4E14\u540C\u4E00\u4EFD\u5546\u54C1\u5728\u4E0D\u540C\u5F52\u7C7B\u51B3\u5B9A\u4E0B\u7684\u7F16\u7801\u53EF\u80FD\u90FD\u6210\u7ACB\u3002
#   \u2192 \u56E0\u6B64\u672C\u63D2\u4EF6\u53EA\u6838\u5BF9**\u53F0\u8D26\u81EA\u8EAB\u7684\u9F50\u5907\u3001\u683C\u5F0F\u4E0E\u81EA\u6D3D**\uFF1A
#     \u5173\u952E\u680F\u662F\u5426\u586B\u9F50\u3001\u5546\u54C1\u7F16\u53F7\u4E0E\u5E01\u5236\u662F\u5426\u5408\u4E4E\u683C\u5F0F\u3001\u5355\u8BC1\u7F16\u53F7\u662F\u5426\u552F\u4E00\u3001
#     \u6BDB\u91CD\u51C0\u91CD\u5173\u7CFB\u662F\u5426\u6210\u7ACB\u3001\u65E5\u671F\u5148\u540E\u662F\u5426\u53EF\u80FD\u3001\u662F\u5426\u6B8B\u7559\u6A21\u677F\u5360\u4F4D\u7B26\u3002
#   \u2192 **\u5F52\u7C7B\u662F\u5426\u6B63\u786E\u7684\u5224\u65AD\u4E00\u5F8B\u4E0D\u505A\u3002**

plugin: dsh-customs-doc-check
version: "2026.1"

rules:
  - id: CD-001
    title: \u5355\u8BC1\u53F0\u8D26\u5E94\u586B\u5199\u54C1\u540D\u4E0E\u603B\u4EF7
    severity: warn
    basis:
      document: \u300A\u4E2D\u534E\u4EBA\u6C11\u5171\u548C\u56FD\u6D77\u5173\u8FDB\u51FA\u53E3\u8D27\u7269\u62A5\u5173\u5355\u586B\u5236\u89C4\u8303\u300B
      number: \u6D77\u5173\u603B\u7F72\u516C\u544A 2019 \u5E74\u7B2C 18 \u53F7\uFF08\u672C\u6B21\u672A\u53D6\u5F97\u6761\u6587\uFF09
      clause: \u5173\u4E8E\u62A5\u5173\u5355\u5404\u680F\u586B\u5236\u8981\u6C42\u7684\u6761\u6B3E\uFF08\u672C\u6B21\u672A\u53D6\u5F97\u6761\u53F7\uFF09
      excerpt: \u8BE5\u6761\u6587\u672C\u6B21\u672A\u53D6\u5F97\uFF1A\u6838\u67E5\u672A\u83B7\u5F97\u300A\u62A5\u5173\u5355\u586B\u5236\u89C4\u8303\u300B\u7684\u9010\u5B57\u539F\u6587\uFF0C\u672C\u89C4\u5219\u5E93\u4E0D\u4F2A\u9020\u5F15\u6587\u3002
      kind: derived-from-principle
      source: http://www.customs.gov.cn/
    params:
      check:
        kind: presenceAny
        fields: [goodsName, amount]
        fix: \u8865\u586B\u54C1\u540D\u4E0E\u603B\u4EF7\uFF1B\u672C\u6761\u53EA\u6838\u5BF9\u662F\u5426\u586B\u5199\uFF0C\u4E0D\u5224\u65AD\u7533\u62A5\u5185\u5BB9\u662F\u5426\u771F\u5B9E
    note: >-
      \u54C1\u540D\u4E0E\u603B\u4EF7\u662F\u4EFB\u4F55\u4E00\u7B14\u7533\u62A5\u7684**\u6700\u4F4E\u53EF\u6838\u5BF9\u4FE1\u606F**\uFF1A\u7F3A\u5176\u4E00\uFF0C\u540E\u7EED\u7684\u6570\u91CF\u5355\u4EF7\u6838\u5BF9\u3001
      \u5E01\u5236\u6838\u5BF9\u3001\u539F\u4EA7\u5730\u6838\u5BF9\u90FD\u65E0\u4ECE\u8C08\u8D77\u3002\u672C\u6B21\u672A\u53D6\u5F97\u660E\u6587\u6761\u53F7\uFF0C\u6545\u5C01\u9876 warn\u3002
      \u672C\u6761\u53EA\u6838\u5BF9"\u81F3\u5C11\u586B\u4E86\u4E00\u4E2A"\uFF0C**\u4E0D\u5224\u65AD\u7533\u62A5\u5185\u5BB9\u662F\u5426\u771F\u5B9E\u3001\u5F52\u7C7B\u662F\u5426\u6B63\u786E**\u3002

  - id: CD-002
    title: \u5546\u54C1\u7F16\u53F7\u5E94\u4E3A\u5341\u4F4D\u6570\u5B57
    severity: warn
    basis:
      document: \u300A\u4E2D\u534E\u4EBA\u6C11\u5171\u548C\u56FD\u6D77\u5173\u8FDB\u51FA\u53E3\u8D27\u7269\u62A5\u5173\u5355\u586B\u5236\u89C4\u8303\u300B
      number: \u6D77\u5173\u603B\u7F72\u516C\u544A 2019 \u5E74\u7B2C 18 \u53F7\uFF08\u672C\u6B21\u672A\u53D6\u5F97\u6761\u6587\uFF09
      clause: \u5173\u4E8E\u5546\u54C1\u7F16\u53F7\u680F\u7684\u586B\u5236\u8981\u6C42\uFF08\u672C\u6B21\u672A\u53D6\u5F97\u6761\u53F7\uFF09
      excerpt: \u8BE5\u6761\u6587\u672C\u6B21\u672A\u53D6\u5F97\uFF1A\u6838\u67E5\u672A\u83B7\u5F97\u300A\u62A5\u5173\u5355\u586B\u5236\u89C4\u8303\u300B\u7684\u9010\u5B57\u539F\u6587\uFF0C\u672C\u89C4\u5219\u5E93\u4E0D\u4F2A\u9020\u5F15\u6587\u3002
      kind: derived-from-principle
      source: http://www.customs.gov.cn/
    params:
      check:
        kind: pattern
        field: hsCode
        pattern: ^[0-9]{10}$
        fix: \u5546\u54C1\u7F16\u53F7\u5E94\u5199\u6210\u5341\u4F4D\u6570\u5B57\uFF1B\u672C\u6761\u7684\u4F4D\u6570\u51FA\u5382\u503C\u4E3A 10\uFF0C\u53EF\u6309\u5F53\u5E74\u7A0E\u5219\u8C03\u6574
    note: >-
      \u5546\u54C1\u7F16\u53F7\uFF08\u7A0E\u5219\u53F7\u5217\uFF09\u7684\u4F4D\u6570\u7531**\u5F53\u5E74\u7A0E\u5219**\u89C4\u5B9A\uFF0C\u6211\u56FD\u73B0\u884C\u7A0E\u5219\u53F7\u5217\u4E3A\u5341\u4F4D\uFF1B
      \u672C\u6B21\u672A\u53D6\u5F97\u660E\u6587\u6761\u53F7\uFF0C\u6545\u5C01\u9876 warn\u3002
      \u672C\u6761**\u53EA\u6838\u5BF9\u4F4D\u6570\u4E0E\u5B57\u7B26\u5408\u6CD5\u6027**\uFF0C**\u7EDD\u4E0D\u5224\u65AD\u5F52\u7C7B\u662F\u5426\u6B63\u786E**\u2014\u2014
      \u540C\u4E00\u5546\u54C1\u7684\u5F52\u7C7B\u5728\u4E0D\u540C\u5F52\u7C7B\u51B3\u5B9A\u6216\u9884\u88C1\u5B9A\u4E0B\u53EF\u80FD\u4E0D\u540C\uFF0C\u90A3\u662F\u6D77\u5173\u4E0E\u5F52\u7C7B\u4E13\u4E1A\u4EBA\u5458\u7684\u5224\u65AD\u3002
      \u82E5\u5F53\u5E74\u7A0E\u5219\u4F4D\u6570\u8C03\u6574\uFF0C\u6539 pattern \u5373\u53EF\uFF0C\u65E0\u9700\u6539\u4EE3\u7801\u3002

  - id: CD-003
    title: \u5E01\u5236\u5E94\u4F7F\u7528\u4E09\u4F4D\u5B57\u6BCD\u4EE3\u7801
    severity: warn
    basis:
      document: \u300A\u8868\u793A\u8D27\u5E01\u7684\u4EE3\u7801\u300B
      number: GB/T 12406\u20142022\uFF08\u8868\u793A\u8D27\u5E01\u7684\u4EE3\u7801\uFF1B2022-12-30 \u53D1\u5E03\u5E76\u5B9E\u65BD\uFF1B\u5168\u90E8\u4EE3\u66FF GB/T 12406\u20142008\uFF08\u8BE5\u7248\u540D\u79F0\u4E3A\u300C\u8868\u793A\u8D27\u5E01\u548C\u8D44\u91D1\u7684\u4EE3\u7801\u300D\uFF09\u2014\u2014\u6CE8\u610F\u65E7\u7248\u540D\u79F0\u542B"\u8D44\u91D1"\uFF1B\u4FEE\u6539\u91C7\u7528 ISO 4217:2015\uFF0C\u975E\u7B49\u540C\u91C7\u7528\uFF1B\u6761\u53F7\u672C\u6B21\u672A\u53D6\u5F97\uFF09
      clause: \u5173\u4E8E\u8D27\u5E01\u4EE3\u7801\u7684\u89C4\u5B9A\uFF08\u672C\u6B21\u672A\u53D6\u5F97\u6761\u53F7\uFF09
      excerpt: \u8BE5\u6761\u6587\u672C\u6B21\u672A\u53D6\u5F97\uFF1A\u6838\u67E5\u672A\u83B7\u5F97 GB/T 12406 \u7684\u9010\u5B57\u539F\u6587\uFF0C\u672C\u89C4\u5219\u5E93\u4E0D\u4F2A\u9020\u5F15\u6587\u3002
      kind: derived-from-principle
      source: https://openstd.samr.gov.cn/bzgk/std/newGbInfo?hcno=196111BC23AC8BDA0BE2C44F2C32F6CF
    params:
      check:
        kind: pattern
        field: currency
        pattern: ^[A-Z]{3}$
        fix: \u5E01\u5236\u5E94\u5199\u6210\u4E09\u4F4D\u5927\u5199\u5B57\u6BCD\u4EE3\u7801\uFF08\u5982 USD\u3001EUR\u3001JPY\u3001HKD\uFF09
    note: >-
      \u672C\u6761\u7684\u4F9D\u636E\u662F**\u300A\u62A5\u5173\u5355\u586B\u5236\u89C4\u8303\u300B\u7B2C\u4E09\u5341\u4E5D\u6761**\uFF08\u636E\u9010\u5B57\u6838\u5BF9\uFF0C\u89C1 rules/evidence/clause-verification.md\uFF09\uFF1A
      \u539F\u6587\u300C**\u6309\u6D77\u5173\u89C4\u5B9A\u7684\u300A\u8D27\u5E01\u4EE3\u7801\u8868\u300B\u9009\u62E9\u76F8\u5E94\u7684\u8D27\u5E01\u540D\u79F0\u53CA\u4EE3\u7801\u586B\u62A5**\u300D\u3002
      \u26A0\uFE0F **\u6761\u6587\u5E76\u672A\u89C4\u5B9A"\u4E09\u4F4D\u5B57\u6BCD"** \u2014\u2014 \u4E09\u4F4D\u5B57\u6BCD\uFF08ISO 4217 \u5F62\u5F0F\uFF09\u662F\u300A\u8D27\u5E01\u4EE3\u7801\u8868\u300B\u7684**\u5B9E\u9645\u5F62\u6001**\uFF0C
      \u800C**\u8BE5\u4EE3\u7801\u8868\u672C\u6B21\u672A\u53D6\u5F97**\u3002\u56E0\u6B64\u672C\u6761\u6838\u5BF9\u7684"\u4E09\u4F4D\u5927\u5199\u5B57\u6BCD"\u662F**\u5F62\u6001\u6838\u5BF9**\uFF0C
      **\u4E0D\u662F\u6761\u6587\u63AA\u8F9E\u7684\u76F4\u63A5\u8981\u6C42**\uFF0C\u6545\u5C01\u9876 warn\u3001kind \u4FDD\u6301 derived-from-principle\u3002
      **\u7279\u522B\u63D0\u793A**\uFF1A\u4EBA\u6C11\u5E01\u5728 ISO 4217 \u4E2D\u7684\u4EE3\u7801\u662F **CNY**\uFF0C\u800C\u62A5\u5173\u5B9E\u52A1\u4E2D CNY \u4E0E RMB \u4E24\u79CD\u5199\u6CD5\u5E76\u5B58\uFF1B
      \u672C\u89C4\u5219\u5E93**\u4E0D\u66FF\u4F7F\u7528\u65B9\u89C4\u5B9A\u8BE5\u7528\u54EA\u4E2A**\u2014\u2014\u82E5\u672C\u673A\u6784\u4E00\u5F8B\u7528\u67D0\u4E2A\u5199\u6CD5\uFF0C\u628A pattern \u6536\u7D27\u5373\u53EF\u3002
      \u672C\u6761**\u4E0D\u5224\u65AD\u5E01\u5236\u9009\u62E9\u662F\u5426\u6B63\u786E**\uFF0C\u90A3\u53D6\u51B3\u4E8E\u5B9E\u9645\u7ED3\u7B97\u5E01\u522B\u3002

  - id: CD-004
    title: \u5355\u8BC1\u7F16\u53F7\u5E94\u5728\u672C\u53F0\u8D26\u5185\u552F\u4E00
    severity: warn
    basis:
      document: \u300A\u4E2D\u534E\u4EBA\u6C11\u5171\u548C\u56FD\u6D77\u5173\u8FDB\u51FA\u53E3\u8D27\u7269\u7533\u62A5\u7BA1\u7406\u89C4\u5B9A\u300B
      number: \u6D77\u5173\u603B\u7F72\u4EE4\uFF08\u73B0\u884C\u4EE4\u53F7\u672C\u6B21\u672A\u6838\u5B9E\uFF09
      clause: \u5173\u4E8E\u5355\u8BC1\u7F16\u53F7\u4E0E\u7533\u62A5\u51ED\u8BC1\u7684\u6761\u6B3E\uFF08\u672C\u6B21\u672A\u53D6\u5F97\u6761\u53F7\uFF09
      excerpt: \u8BE5\u6761\u6587\u672C\u6B21\u672A\u53D6\u5F97\uFF1A\u6838\u67E5\u672A\u83B7\u5F97\u8BE5\u89C4\u5B9A\u7684\u9010\u5B57\u539F\u6587\uFF0C\u672C\u89C4\u5219\u5E93\u4E0D\u4F2A\u9020\u5F15\u6587\u3002
      kind: derived-from-principle
      source: http://www.customs.gov.cn/
    params:
      check:
        kind: unique
        field: docNo
    note: >-
      \u5355\u8BC1\u7F16\u53F7\u552F\u4E00\u662F"\u540C\u4E00\u4EFD\u5355\u8BC1\u53EA\u88AB\u767B\u8BB0\u4E00\u6B21"\u7684**\u524D\u63D0\u6761\u4EF6**\uFF1A\u7F16\u53F7\u91CD\u590D\u4F1A\u8BA9\u4EBA\u65E0\u6CD5\u5224\u65AD
      \u5230\u5E95\u662F\u91CD\u590D\u767B\u8BB0\uFF0C\u8FD8\u662F\u4E24\u4EFD\u4E0D\u540C\u5355\u8BC1\u88AB\u9519\u7F16\u6210\u540C\u4E00\u53F7\u3002\u672C\u6B21\u672A\u53D6\u5F97\u660E\u6587\u6761\u53F7\uFF0C\u6545\u5C01\u9876 warn\u3002
      \u6BD4\u8F83\u65F6\u5FFD\u7565\u7A7A\u767D\u5B57\u7B26\u3002\u547D\u4E2D\u901A\u5E38\u610F\u5473\u7740\u91CD\u590D\u767B\u8BB0\u6216\u7F16\u53F7\u6284\u9519\uFF0C\u9700\u4EBA\u5DE5\u786E\u8BA4\u3002

  - id: CD-005
    title: \u6BDB\u91CD\u5E94\u4E0D\u5C0F\u4E8E\u51C0\u91CD
    severity: warn
    basis:
      document: \u300A\u4E2D\u534E\u4EBA\u6C11\u5171\u548C\u56FD\u6D77\u5173\u8FDB\u51FA\u53E3\u8D27\u7269\u62A5\u5173\u5355\u586B\u5236\u89C4\u8303\u300B
      number: \u6D77\u5173\u603B\u7F72\u516C\u544A 2019 \u5E74\u7B2C 18 \u53F7\uFF08\u672C\u6B21\u672A\u53D6\u5F97\u6761\u6587\uFF09
      clause: \u5173\u4E8E\u6BDB\u91CD\u4E0E\u51C0\u91CD\u680F\u7684\u586B\u5236\u8981\u6C42\uFF08\u672C\u6B21\u672A\u53D6\u5F97\u6761\u53F7\uFF09
      excerpt: \u8BE5\u6761\u6587\u672C\u6B21\u672A\u53D6\u5F97\uFF1A\u6838\u67E5\u672A\u83B7\u5F97\u300A\u62A5\u5173\u5355\u586B\u5236\u89C4\u8303\u300B\u7684\u9010\u5B57\u539F\u6587\uFF0C\u672C\u89C4\u5219\u5E93\u4E0D\u4F2A\u9020\u5F15\u6587\u3002
      kind: derived-from-principle
      source: http://www.customs.gov.cn/
    params:
      check:
        kind: fieldComparison
        leftField: grossWeight
        rightField: netWeight
        relation: gte
    note: >-
      \u6BDB\u91CD\u5305\u542B\u5305\u88C5\u3001\u51C0\u91CD\u4E0D\u542B\uFF0C\u6545**\u6BDB\u91CD\u4E0D\u5C0F\u4E8E\u51C0\u91CD**\u662F\u8FD9\u4E24\u4E2A\u5B57\u6BB5\u7684\u8BED\u4E49\u524D\u63D0\uFF1B
      \u672C\u6B21\u672A\u53D6\u5F97\u660E\u6587\u6761\u53F7\uFF0C\u6545\u5C01\u9876 warn\u3002
      \u672C\u6761\u53EA\u505A\u6570\u503C\u6BD4\u8F83\uFF08\u53EF\u5E26\u5355\u4F4D\uFF0C\u5982 12.5KGS\uFF09\uFF1B\u4E24\u4E2A\u5B57\u6BB5\u7F3A\u5176\u4E00\u5373\u8FDB skipped\u3002
      \u547D\u4E2D\u901A\u5E38\u610F\u5473\u7740\u4E24\u680F\u586B\u53CD\u6216\u6284\u9519\uFF0C\u9700\u4EBA\u5DE5\u786E\u8BA4\u2014\u2014**\u4E0D\u5224\u65AD\u91CD\u91CF\u7533\u62A5\u662F\u5426\u771F\u5B9E**\u3002

  - id: CD-006
    title: \u7533\u62A5\u65E5\u671F\u5E94\u53EF\u89E3\u6790\uFF0C\u4E14\u4E0D\u5E94\u665A\u4E8E\u6838\u5BF9\u65E5
    severity: warn
    basis:
      document: \u300A\u4E2D\u534E\u4EBA\u6C11\u5171\u548C\u56FD\u6D77\u5173\u8FDB\u51FA\u53E3\u8D27\u7269\u7533\u62A5\u7BA1\u7406\u89C4\u5B9A\u300B
      number: \u6D77\u5173\u603B\u7F72\u4EE4\uFF08\u73B0\u884C\u4EE4\u53F7\u672C\u6B21\u672A\u6838\u5B9E\uFF09
      clause: \u5173\u4E8E\u7533\u62A5\u65E5\u671F\u7684\u6761\u6B3E\uFF08\u672C\u6B21\u672A\u53D6\u5F97\u6761\u53F7\uFF09
      excerpt: \u8BE5\u6761\u6587\u672C\u6B21\u672A\u53D6\u5F97\uFF1A\u6838\u67E5\u672A\u83B7\u5F97\u8BE5\u89C4\u5B9A\u7684\u9010\u5B57\u539F\u6587\uFF0C\u672C\u89C4\u5219\u5E93\u4E0D\u4F2A\u9020\u5F15\u6587\u3002
      kind: derived-from-principle
      source: http://www.customs.gov.cn/
    params:
      check:
        kind: date
        field: declaredAt
        notAfter: today
    note: >-
      \u7533\u62A5\u65E5\u671F\u53EF\u89E3\u6790\u662F\u53F0\u8D26\u80FD\u88AB\u7A0B\u5E8F\u5904\u7406\u7684\u524D\u63D0\uFF1B\u4E0D\u5E94\u665A\u4E8E\u6838\u5BF9\u65E5\uFF0C
      \u662F"\u8FD9\u662F\u5DF2\u53D1\u751F\u7684\u7533\u62A5"\u7684**\u81EA\u6D3D\u6761\u4EF6**\u3002
      \u4F9D\u636E\u8BF4\u660E\uFF08\u636E\u300A\u62A5\u5173\u5355\u586B\u5236\u89C4\u8303\u300B**\u7B2C\u4E94\u6761\u3001\u7B2C\u516D\u6761**\u9010\u5B57\u6838\u5BF9\uFF09\uFF1A
      \u6761\u6587\u539F\u6587\u300C**\u8FDB\u51FA\u53E3\u65E5\u671F\u4E3A 8 \u4F4D\u6570\u5B57\uFF0C\u987A\u5E8F\u4E3A\u5E74\uFF084 \u4F4D\uFF09\u3001\u6708\uFF082 \u4F4D\uFF09\u3001\u65E5\uFF082 \u4F4D\uFF09**\u300D\u3001
      \u300C**\u7533\u62A5\u65E5\u671F\u4E3A 8 \u4F4D\u6570\u5B57\uFF0C\u987A\u5E8F\u4E3A\u5E74\uFF084 \u4F4D\uFF09\u3001\u6708\uFF082 \u4F4D\uFF09\u3001\u65E5\uFF082 \u4F4D\uFF09**\u300D\u3002
      \u26A0\uFE0F **\u5FC5\u987B\u6CE8\u610F\u7684\u4F8B\u5916**\uFF1A\u7B2C\u516D\u6761\u6587\u672B\u660E\u786E\u300C**\u672C\u680F\u76EE\u5728\u7533\u62A5\u65F6\u514D\u4E88\u586B\u62A5**\u300D\u2014\u2014
      \u5373**\u7533\u62A5\u65B9\u5728\u7533\u62A5\u65F6\u5E76\u4E0D\u586B\u7533\u62A5\u65E5\u671F**\uFF08\u7531\u6D77\u5173\u8BA1\u7B97\u673A\u7CFB\u7EDF\u5728\u63A5\u53D7\u7533\u62A5\u6570\u636E\u65F6\u8BB0\u5F55\uFF09\u3002
      \u21D2 **\u53F0\u8D26\u91CC\u6CA1\u6709\u7533\u62A5\u65E5\u671F\u662F\u6B63\u5E38\u7684\uFF0C\u672C\u6761\u4E0D\u5E94\u56E0"\u6CA1\u586B"\u800C\u62A5\u9519**\uFF1B
      \u5B83\u53EA\u5728"\u586B\u4E86\u7684\u8BDD"\u6838\u5BF9\u53EF\u89E3\u6790\u6027\u4E0E\u5148\u540E\u3002
      \u65E5\u671F\u65E0\u6CD5\u89E3\u6790\u65F6\u4F1A\u5355\u72EC\u62A5\u51FA\uFF0C**\u4E0D\u4F1A\u9759\u9ED8\u8DF3\u8FC7**\u3002
      \u672C\u6761**\u4E0D\u5224\u65AD\u7533\u62A5\u662F\u5426\u5728\u6CD5\u5B9A\u671F\u9650\u5185**\u2014\u2014\u90A3\u53D6\u51B3\u4E8E\u8FD0\u8F93\u65B9\u5F0F\u4E0E\u5177\u4F53\u89C4\u5B9A\u3002

  - id: CD-007
    title: \u53F0\u8D26\u5173\u952E\u680F\u4E0D\u5E94\u6B8B\u7559\u672A\u66FF\u6362\u7684\u5360\u4F4D\u7B26
    severity: warn
    basis:
      document: \u300A\u4E2D\u534E\u4EBA\u6C11\u5171\u548C\u56FD\u6D77\u5173\u8FDB\u51FA\u53E3\u8D27\u7269\u62A5\u5173\u5355\u586B\u5236\u89C4\u8303\u300B
      number: \u6D77\u5173\u603B\u7F72\u516C\u544A 2019 \u5E74\u7B2C 18 \u53F7\uFF08\u672C\u6B21\u672A\u53D6\u5F97\u6761\u6587\uFF09
      clause: \u5173\u4E8E\u5404\u680F\u5E94\u636E\u5B9E\u586B\u5236\u7684\u6761\u6B3E\uFF08\u672C\u6B21\u672A\u53D6\u5F97\u6761\u53F7\uFF09
      excerpt: \u8BE5\u6761\u6587\u672C\u6B21\u672A\u53D6\u5F97\uFF1A\u6838\u67E5\u672A\u83B7\u5F97\u300A\u62A5\u5173\u5355\u586B\u5236\u89C4\u8303\u300B\u7684\u9010\u5B57\u539F\u6587\uFF0C\u672C\u89C4\u5219\u5E93\u4E0D\u4F2A\u9020\u5F15\u6587\u3002
      kind: derived-from-principle
      source: http://www.customs.gov.cn/
    params:
      check:
        kind: containsAny
        field: goodsName
        terms: ['\u3010', '\u3011', '{{', '}}', 'XXX', 'xxx', '\u5F85\u586B', '\u5F85\u8865\u5145', 'TBD', 'todo', '\u793A\u4F8B']
        fix: \u54C1\u540D\u5E94\u586B\u5199\u5B9E\u9645\u8D27\u7269\u540D\u79F0\uFF1B\u6B8B\u7559\u5360\u4F4D\u7B26\u8BF4\u660E\u53F0\u8D26\u662F\u7167\u6A21\u677F\u6284\u7684
    note: >-
      \u53F0\u8D26\u82E5\u76F4\u63A5\u7167\u6284\u6A21\u677F\uFF0C\u54C1\u540D\u680F\u5E38\u7559\u4E0B\u3010\u3011\u3001{{}}\u3001XXX\u3001\u5F85\u586B\u3001TBD \u4E4B\u7C7B\u5360\u4F4D\u7B26\u3002
      \u8FD9\u4F1A\u8BA9\u4EBA\u8BEF\u4EE5\u4E3A\u5DF2\u7ECF\u6838\u5BF9\u4E86\u5B9E\u9645\u5355\u8BC1\u2014\u2014**\u8FD9\u662F\u53F0\u8D26\u7C7B\u5DE5\u5177\u6700\u5371\u9669\u7684\u5931\u6548\u65B9\u5F0F**\u3002
      \u672C\u6B21\u672A\u53D6\u5F97\u660E\u6587\u6761\u53F7\uFF0C\u6545\u5C01\u9876 warn\u3002terms \u53EF\u6309\u672C\u673A\u6784\u6A21\u677F\u8C03\u6574\u3002

disabled: []
`;

// ../../mnt/d/Projects/dsh/checkers/dsh-customs-doc-check/src/shared/wording.ts
var FORBIDDEN_WORDING = [
  "\u5408\u89C4",
  "\u4E0D\u5408\u89C4",
  "\u8FDD\u89C4",
  "\u8FDD\u6CD5",
  "\u4E0D\u5408\u683C",
  "\u5408\u683C\u8BC1",
  "\u901A\u8FC7\u9A8C\u6536",
  "\u5BA1\u67E5\u901A\u8FC7",
  "\u5BA1\u6838\u901A\u8FC7",
  "\u6784\u6210\u8FDD\u6CD5",
  "\u6784\u6210\u72AF\u7F6A",
  "\u6784\u6210\u865A\u5F00",
  "\u865A\u5F00",
  "\u5DF2\u5408\u89C4",
  "\u4F9D\u6CD5\u8FFD\u7A76",
  "\u65E0\u6548\u5408\u540C",
  "\u5408\u540C\u65E0\u6548"
];
var ALLOWED_PHRASES = [
  "\u672A\u901A\u8FC7",
  "\u4E0D\u901A\u8FC7",
  "\u53EF\u901A\u8FC7",
  "\u672A\u6784\u6210",
  "\u4E0D\u6784\u6210",
  "\u5408\u683C\u5224\u5B9A\u51C6\u5219"
];
var QUOTED_SPAN = /《[^》]*》|「[^」]*」/g;
var DISCLAIMER = "\u514D\u8D23\u58F0\u660E\uFF1A\u672C\u62A5\u544A\u7531\u7A0B\u5E8F\u6309\u58F0\u660E\u7684\u89C4\u5219\u96C6\u81EA\u52A8\u751F\u6210\uFF0C\u4EC5\u5217\u51FA\u4E0E\u6240\u5F15\u6761\u6B3E\u4E4B\u95F4\u7684\u5B57\u9762\u5DEE\u5F02\uFF0C\u4F9B\u4EBA\u5DE5\u590D\u6838\u7EBF\u7D22\u4F7F\u7528\uFF1B\u4E0D\u6784\u6210\u5BF9\u4EFB\u4F55\u4E8B\u5B9E\u3001\u884C\u4E3A\u6216\u6587\u4EF6\u7684\u5B9A\u6027\u610F\u89C1\uFF0C\u4E5F\u4E0D\u66FF\u4EE3\u4E3B\u7BA1\u4EBA\u5458\u3001\u8BC4\u5BA1\u4E13\u5BB6\u6216\u76D1\u7BA1\u673A\u6784\u7684\u5224\u65AD\u3002\u89C4\u5219\u96C6\u7684\u65F6\u6548\u6027\u4E0E\u9002\u7528\u8303\u56F4\u4EE5\u5F15\u7528\u6587\u4EF6\u7684\u6700\u65B0\u6709\u6548\u7248\u672C\u4E3A\u51C6\u3002";
function findForbiddenWording(text) {
  let scrubbed = text.replace(QUOTED_SPAN, "\0");
  for (const allowed of ALLOWED_PHRASES) scrubbed = scrubbed.split(allowed).join("\0");
  const hits = [];
  for (const phrase of FORBIDDEN_WORDING) {
    if (scrubbed.includes(phrase)) hits.push(phrase);
  }
  return hits;
}

// ../../mnt/d/Projects/dsh/checkers/dsh-customs-doc-check/src/shared/render.ts
var SEVERITY_LABEL = {
  error: "\u9519\u8BEF",
  warn: "\u63D0\u793A",
  info: "\u53C2\u8003"
};
function formatLocator(locator) {
  const parts = [];
  if (locator.file !== void 0) parts.push(locator.file);
  if (locator.page !== void 0) parts.push(`\u7B2C${locator.page}\u9875`);
  if (locator.line !== void 0) parts.push(`\u7B2C${locator.line}\u884C`);
  if (locator.para !== void 0) parts.push(`\u7B2C${locator.para}\u6BB5`);
  if (locator.row !== void 0) parts.push(`\u7B2C${locator.row}\u884C\u6570\u636E`);
  if (locator.cell !== void 0) parts.push(`\u5355\u5143\u683C${locator.cell}`);
  if (locator.column !== void 0) parts.push(`\u5B57\u6BB5${locator.column}`);
  return parts.length === 0 ? "(\u672A\u5B9A\u4F4D)" : parts.join(" \xB7 ");
}
function formatIssue(issue) {
  const lines = [];
  lines.push(`- **[${SEVERITY_LABEL[issue.severity]}] ${issue.ruleId}** \u2014 ${formatLocator(issue.locator)}`);
  lines.push(`  - \u5B9E\u9645\uFF1A${issue.found}`);
  lines.push(`  - \u4F9D\u636E\u8981\u6C42\uFF1A${issue.expected}`);
  lines.push(`  - \u6761\u6B3E\u4F9D\u636E\uFF1A${issue.basis}`);
  if (issue.fix !== void 0) lines.push(`  - \u5EFA\u8BAE\u6838\u5BF9\uFF1A${issue.fix}`);
  if (issue.engine !== void 0) {
    lines.push(`  - \u68C0\u7D22\u5F15\u64CE\uFF1A${issue.engine}${issue.engineVersion === void 0 ? "" : `@${issue.engineVersion}`}`);
  }
  lines.push(`  - \u7F16\u53F7\uFF1A\`${issue.id}\``);
  return lines.join("\n");
}
function renderMarkdown(report) {
  const lines = [];
  lines.push(`# ${report.plugin} \u68C0\u67E5\u7ED3\u679C`);
  lines.push("");
  lines.push(`- \u68C0\u67E5\u5BF9\u8C61\uFF1A${report.target}`);
  lines.push(`- \u68C0\u67E5\u65F6\u95F4\uFF1A${report.checkedAt}`);
  lines.push(`- \u89C4\u5219\u96C6\u7248\u672C\uFF1A${report.rulesetVersion}`);
  lines.push(
    `- \u7ED3\u679C\u7EDF\u8BA1\uFF1A\u9519\u8BEF ${report.summary.error} \xB7 \u63D0\u793A ${report.summary.warn} \xB7 \u53C2\u8003 ${report.summary.info} \xB7 \u5171 ${report.issues.length} \u6761`
  );
  lines.push("");
  if (report.issues.length === 0) {
    lines.push("## \u660E\u7EC6");
    lines.push("");
    lines.push("\u672C\u6B21\u89C4\u5219\u96C6\u8986\u76D6\u7684\u68C0\u67E5\u9879\u672A\u4EA7\u751F\u5DEE\u5F02\u6761\u76EE\u3002");
    lines.push("");
  } else {
    lines.push("## \u660E\u7EC6");
    lines.push("");
    for (const issue of report.issues) {
      lines.push(formatIssue(issue));
      lines.push("");
    }
  }
  lines.push("## \u672A\u6267\u884C\u7684\u68C0\u67E5");
  lines.push("");
  if (report.skipped.length === 0) {
    lines.push("\u89C4\u5219\u96C6\u58F0\u660E\u7684\u5168\u90E8\u68C0\u67E5\u9879\u5747\u5DF2\u6267\u884C\u3002");
  } else {
    lines.push("\u4EE5\u4E0B\u68C0\u67E5\u9879\u56E0\u6750\u6599\u4E0D\u8DB3\u6216\u524D\u7F6E\u6761\u4EF6\u4E0D\u6EE1\u8DB3\u800C\u672A\u6267\u884C\uFF0C\u5176\u7ED3\u8BBA\u4E0D\u5305\u542B\u5728\u672C\u62A5\u544A\u4E2D\uFF1A");
    lines.push("");
    for (const entry of report.skipped) lines.push(`- \`${entry.rule}\`\uFF1A${entry.reason}`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(DISCLAIMER);
  const text = lines.join("\n");
  const hits = findForbiddenWording(text);
  if (hits.length > 0) {
    throw new Error(`renderMarkdown: forbidden adjudicating wording in output: ${hits.join(", ")}`);
  }
  return text;
}

// ../../mnt/d/Projects/dsh/checkers/dsh-customs-doc-check/src/shared/ruleset.ts
var SEVERITIES = ["error", "warn", "info"];
var BASIS_KINDS = ["direct", "derived-from-principle", "institutional-configuration"];
var MAX_SEVERITY_BY_KIND = {
  direct: "error",
  "derived-from-principle": "warn",
  "institutional-configuration": "info"
};
var SEVERITY_RANK = { error: 2, warn: 1, info: 0 };
function asRecord(value, where) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new YamlSubsetError(`${where}: expected a mapping`);
  }
  return value;
}
function asStringArray(value, where) {
  if (value === void 0 || value === null) return [];
  if (!Array.isArray(value)) throw new YamlSubsetError(`${where}: expected a sequence`);
  return value.map((entry) => {
    if (typeof entry !== "string") throw new YamlSubsetError(`${where}: expected string entries`);
    return entry;
  });
}
function parseBasis(value, where) {
  const source = asRecord(value, where);
  const kindRaw = requireString(source, "kind", where);
  if (!BASIS_KINDS.includes(kindRaw)) {
    throw new YamlSubsetError(`${where}: kind must be one of ${BASIS_KINDS.join(" / ")}`);
  }
  const basis = {
    document: requireString(source, "document", where),
    number: typeof source.number === "string" ? source.number : "",
    clause: requireString(source, "clause", where),
    excerpt: requireString(source, "excerpt", where),
    kind: kindRaw,
    source: requireString(source, "source", where)
  };
  if (basis.excerpt.trim().length < 8) {
    throw new YamlSubsetError(`${where}: excerpt is too short to be a verbatim quotation`);
  }
  return basis;
}
function parseRule(value, index) {
  const where = `rules[${index}]`;
  const source = asRecord(value, where);
  const id = requireString(source, "id", where);
  const severityRaw = requireString(source, "severity", where);
  if (!SEVERITIES.includes(severityRaw)) {
    throw new YamlSubsetError(`${where}: severity must be one of ${SEVERITIES.join(" / ")}`);
  }
  const basis = parseBasis(source.basis, `${where}.basis`);
  const severity = severityRaw;
  const ceiling = MAX_SEVERITY_BY_KIND[basis.kind];
  if (SEVERITY_RANK[severity] > SEVERITY_RANK[ceiling]) {
    throw new YamlSubsetError(
      `${where} (${id}): severity "${severity}" is not allowed for a "${basis.kind}" basis; the strongest permitted severity is "${ceiling}"`
    );
  }
  const rule = {
    id,
    title: requireString(source, "title", where),
    severity,
    basis,
    params: source.params === void 0 || source.params === null ? {} : asRecord(source.params, `${where}.params`)
  };
  if (source.alsoBasis !== void 0 && source.alsoBasis !== null) {
    if (!Array.isArray(source.alsoBasis)) throw new YamlSubsetError(`${where}.alsoBasis: expected a sequence`);
    rule.alsoBasis = source.alsoBasis.map((entry, offset) => parseBasis(entry, `${where}.alsoBasis[${offset}]`));
  }
  if (typeof source.note === "string") rule.note = source.note;
  return rule;
}
function loadRuleset(source) {
  const root = asRecord(parseYaml(source), "ruleset");
  const plugin = requireString(root, "plugin", "ruleset");
  const version = requireString(root, "version", "ruleset");
  const rulesRaw = root.rules;
  if (!Array.isArray(rulesRaw) || rulesRaw.length === 0) {
    throw new YamlSubsetError('ruleset: "rules" must be a non-empty sequence');
  }
  const rules = rulesRaw.map((entry, index) => parseRule(entry, index));
  const seen = /* @__PURE__ */ new Set();
  for (const rule of rules) {
    if (seen.has(rule.id)) throw new YamlSubsetError(`ruleset: duplicate rule id "${rule.id}"`);
    seen.add(rule.id);
  }
  const disabled = asStringArray(root.disabled, "ruleset.disabled");
  for (const id of disabled) {
    if (!seen.has(id)) throw new YamlSubsetError(`ruleset.disabled: unknown rule id "${id}"`);
  }
  return { version, plugin, rules, disabled };
}

// entry-customs.ts
var PLUGIN = "dsh-customs-doc-check";
var ruleset = loadRuleset(customs_doc_check_default);
function check(material, target = "material", checkedAt = (/* @__PURE__ */ new Date()).toISOString(), options = {}) {
  const input = parseMaterial(material, target);
  return runTableCheck(input, ruleset, {
    plugin: PLUGIN,
    checkedAt,
    disabledRules: options.disabledRules ?? [],
    onlyRules: options.onlyRules ?? [],
    ...options.skipNotes === void 0 ? {} : { skipNotes: options.skipNotes }
  });
}
var COLUMN_CONTRACT = {
  header: Object.keys(SPEC.header ?? {}),
  columns: Object.entries(SPEC.columns ?? {}).map(([field, aliases]) => ({
    field,
    aliases
  }))
};
var UNCITED_MARKER = "\u672C\u6B21\u672A\u53D6\u5F97";
function rulebook() {
  const rules = ruleset.rules.map((rule) => {
    const excerpt = String(rule.basis?.excerpt ?? "");
    return {
      id: rule.id,
      title: rule.title,
      severity: rule.severity,
      basisKind: rule.basis?.kind ?? null,
      document: rule.basis?.document ?? null,
      clause: rule.basis?.clause ?? null,
      source: rule.basis?.source ?? null,
      verbatimClause: !excerpt.includes(UNCITED_MARKER),
      // Why a rule can never rise above its current severity, stated rather
      // than left for the reader to infer from the basis kind.
      severityCapReason: rule.basis?.kind === "derived-from-principle" ? "\u539F\u5219\u6027\u6761\u6B3E\u63A8\u8BBA\uFF0C\u5C01\u9876 warn" : rule.basis?.kind === "institutional-configuration" ? "\u9608\u503C\u51FA\u81EA\u672C\u673A\u6784\u914D\u7F6E\uFF0C\u5C01\u9876 info" : null
    };
  });
  const tally = (values) => values.reduce((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
  return {
    plugin: PLUGIN,
    rulesetVersion: ruleset.version,
    coverage: {
      rules: rules.length,
      verbatimClause: rules.filter((rule) => rule.verbatimClause).length,
      uncited: rules.filter((rule) => !rule.verbatimClause).length,
      note: "verbatimClause=false means the pack states it could not obtain the clause text. It does not mean the check has no basis, and this server does not upgrade a derived rule to a stated one.",
      bySeverity: tally(rules.map((rule) => String(rule.severity))),
      byBasisKind: tally(rules.map((rule) => String(rule.basisKind)))
    },
    rules
  };
}
var main = () => {
  const args = process.argv.slice(2);
  if (args.includes("--schema")) {
    console.log(JSON.stringify(COLUMN_CONTRACT, null, 2));
    return 0;
  }
  if (args.includes("--rulebook")) {
    console.log(JSON.stringify(rulebook(), null, 2));
    return 0;
  }
  const file = args.find((arg) => !arg.startsWith("--"));
  let material;
  let target;
  try {
    if (file === void 0 || file === "-") {
      material = readFileSync(0, "utf8");
      target = "stdin";
    } else {
      material = readFileSync(file, "utf8");
      target = file;
    }
  } catch (error) {
    console.error(`cannot read the material: ${error.message}`);
    return 2;
  }
  let report;
  try {
    report = check(material, target);
  } catch (error) {
    console.error(`the material was rejected by the reader: ${error.message}`);
    return 2;
  }
  if (args.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else console.log(renderMarkdown(report));
  return report.issues.length === 0 ? 0 : 1;
};
if (process.argv[1] !== void 0 && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
export {
  COLUMN_CONTRACT,
  PLUGIN,
  SPEC,
  check,
  renderMarkdown,
  rulebook
};
