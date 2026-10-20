// Zero-dependency .docx -> structured text, for skills that must read a tender
// document without installing anything.
//
// Why this exists at all: the shared check engine takes JSON/YAML and nothing
// else (table.ts:93). Everything upstream of that - a .docx on the user's disk -
// is the skill's own problem, and the skill runs in hosts that may have no
// node_modules at all (the WorkBuddy sandbox is the known case). So the whole
// pipeline is: this file turns the document into text a model can read, the
// model turns the text into the table shape, check.mjs turns the table into a
// report. Each step degrades on its own.
//
// A .docx is a ZIP whose word/document.xml holds the body. Node ships inflate
// (zlib) but no ZIP reader, so the central directory is parsed by hand here.
// That is ~70 lines, and it is why this file has no dependencies.
//
// Output is deliberately plain: one paragraph per line, and each table row as a
// `| a | b | c |` line. Markdown pipe syntax is what models already parse well,
// and no separator row is emitted because the reader does not need one.
//
// Library form: `docxToText(buffer)` returns the same text the CLI printed.
import { readFileSync } from 'node:fs'
import { inflateRawSync } from 'node:zlib'

/** Locate the End of Central Directory record: at most 64 KiB from the end. */
const findEocd = (buf) => {
  const floor = Math.max(0, buf.length - 0x10000 - 22)
  for (let i = buf.length - 22; i >= floor; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i
  }
  return -1
}

/**
 * Read every entry of the archive through its central-directory record.
 * Going through the central directory rather than walking local headers is what
 * makes streamed archives (general-purpose flag bit 3 set, sizes only in a data
 * descriptor) work - and Word writes those.
 */
const readZip = (buf) => {
  const eocd = findEocd(buf)
  if (eocd === -1) throw new Error('not a ZIP archive (no end-of-central-directory record)')
  const count = buf.readUInt16LE(eocd + 10)
  const cdOffset = buf.readUInt32LE(eocd + 16)
  const entries = new Map()
  let p = cdOffset
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('corrupt central directory')
    const method = buf.readUInt16LE(p + 10)
    const compressedSize = buf.readUInt32LE(p + 20)
    const nameLength = buf.readUInt16LE(p + 28)
    const extraLength = buf.readUInt16LE(p + 30)
    const commentLength = buf.readUInt16LE(p + 32)
    const localOffset = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLength)
    entries.set(name, { method, compressedSize, localOffset })
    p += 46 + nameLength + extraLength + commentLength
  }
  return {
    names: () => [...entries.keys()],
    read: (name) => {
      const entry = entries.get(name)
      if (entry === undefined) return undefined
      // The local header repeats the name and may carry an extra field, so the
      // payload offset has to be recomputed from it rather than from the
      // central directory's copy.
      const local = entry.localOffset
      if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error(`corrupt local header for ${name}`)
      const nameLength = buf.readUInt16LE(local + 26)
      const extraLength = buf.readUInt16LE(local + 28)
      const start = local + 30 + nameLength + extraLength
      const payload = buf.subarray(start, start + entry.compressedSize)
      if (entry.method === 0) return payload
      if (entry.method === 8) return inflateRawSync(payload)
      throw new Error(`unsupported compression method ${entry.method} for ${name}`)
    },
  }
}

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

const decodeEntities = (text) =>
  text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/gu, (whole, body) => {
    if (body.startsWith('#x') || body.startsWith('#X')) return String.fromCodePoint(Number.parseInt(body.slice(2), 16))
    if (body.startsWith('#')) return String.fromCodePoint(Number.parseInt(body.slice(1), 10))
    return NAMED[body] ?? whole
  })

/**
 * Split XML into tags and text.
 * A real parser is unnecessary: the only thing needed is element nesting, and
 * the only construct that could defeat a naive scan - a `>` inside an attribute
 * value - does occur in Word's markup, so quotes are tracked.
 */
function* tokens(xml) {
  let i = 0
  while (i < xml.length) {
    const lt = xml.indexOf('<', i)
    if (lt === -1) {
      yield { type: 'text', value: xml.slice(i) }
      return
    }
    if (lt > i) yield { type: 'text', value: xml.slice(i, lt) }
    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt)
      i = end === -1 ? xml.length : end + 3
      continue
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt)
      yield { type: 'text', value: xml.slice(lt + 9, end === -1 ? xml.length : end), cdata: true }
      i = end === -1 ? xml.length : end + 3
      continue
    }
    if (xml.startsWith('<?', lt) || xml.startsWith('<!', lt)) {
      const end = xml.indexOf('>', lt)
      i = end === -1 ? xml.length : end + 1
      continue
    }
    // Walk to the matching '>' while ignoring any inside quoted values.
    let quote
    let j = lt + 1
    while (j < xml.length) {
      const ch = xml[j]
      if (quote !== undefined) {
        if (ch === quote) quote = undefined
      } else if (ch === '"' || ch === "'") {
        quote = ch
      } else if (ch === '>') {
        break
      }
      j++
    }
    const raw = xml.slice(lt + 1, j)
    i = j + 1
    if (raw.startsWith('/')) {
      yield { type: 'close', name: raw.slice(1).trim() }
      continue
    }
    const selfClosing = raw.endsWith('/')
    const body = selfClosing ? raw.slice(0, -1) : raw
    const space = body.search(/[\s]/u)
    const name = space === -1 ? body : body.slice(0, space)
    const attrs = {}
    if (space !== -1) {
      for (const match of body.slice(space).matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gu)) {
        attrs[match[1]] = decodeEntities(match[2] ?? match[3] ?? '')
      }
    }
    yield { type: 'open', name, attrs, selfClosing }
  }
}

const localName = (name) => (name.includes(':') ? name.slice(name.indexOf(':') + 1) : name)
const W = 'w:'
/** Property containers: their children are formatting, never text. */
const PROPS = new Set(['pPr', 'rPr', 'tblPr', 'trPr', 'tcPr', 'sectPr', 'tblGrid', 'tabs'])

/**
 * Walk the body and produce a list of blocks.
 *
 * A frame stack rather than a handful of cursors, for two reasons:
 *   * a 评分办法 nests a sub-table inside a cell (评分细则 under one 评审因素);
 *   * merged cells are everywhere, and a gridSpan cell must not shift the
 *     columns of the rows below it.
 * A vertically merged cell carries its first value down, because that is what a
 * reader sees; emitting the empty continuation cell instead invites the model to
 * invent a value for it.
 */
const extract = (xml, { resolveVerticalMerge = true } = {}) => {
  const body = { kind: 'body', blocks: [] }
  const frames = [body]
  const top = () => frames[frames.length - 1]
  let propsDepth = 0
  // Deleted text (w:delText) and field instructions (w:instrText) live inside a
  // run, so they would otherwise be appended to the paragraph like normal text.
  let skipDepth = 0

  const popP = () => {
    const frame = top()
    if (frame?.kind !== 'p') return
    frames.pop()
    const text = frame.runs.join('').replace(/[ \t]+$/u, '')
    const parent = top()
    if (parent.kind === 'cell') parent.blocks.push({ type: 'p', text })
    else if (parent.kind === 'body') parent.blocks.push({ type: 'p', text })
    // A paragraph inside a row (malformed) is dropped rather than guessed at.
  }

  const cellText = (frame) => {
    const lines = []
    for (const block of frame.blocks) {
      if (block.type === 'p') {
        if (block.text.trim() !== '') lines.push(block.text.trim())
      } else {
        // A nested table is flattened to one line per row, prefixed so the model
        // can tell it is a sub-grid rather than the outer row's content.
        for (const row of block.rows) {
          const value = row.cells.map(c => c.text).filter(v => v !== '').join(' / ')
          if (value !== '') lines.push(`${value}；`)
        }
      }
    }
    return lines.join('\n')
  }

  const popTc = () => {
    const frame = top()
    if (frame?.kind !== 'cell') return
    frames.pop()
    const parent = top()
    if (parent.kind === 'row') {
      parent.cells.push({ text: cellText(frame), spans: frame.spans, vMerge: frame.vMerge })
    }
  }

  const popTr = () => {
    const frame = top()
    if (frame?.kind !== 'row') return
    frames.pop()
    const parent = top()
    if (parent.kind === 'table') parent.rows.push(frame)
  }

  const popTbl = () => {
    const frame = top()
    if (frame?.kind !== 'table') return
    frames.pop()
    const parent = top()
    const block = { type: 'table', rows: frame.rows }
    if (parent.kind === 'cell') parent.blocks.push(block)
    else if (parent.kind === 'body') parent.blocks.push(block)
  }

  for (const token of tokens(xml)) {
    if (token.type === 'text') {
      const frame = top()
      if (frame.kind === 'p' && propsDepth === 0 && skipDepth === 0) {
        frame.runs.push(token.cdata ? token.value : decodeEntities(token.value))
      }
      continue
    }
    const name = token.name
    const local = localName(name)
    const isW = name.startsWith(W)

    if (token.type === 'open') {
      if (isW && PROPS.has(local)) {
        if (!token.selfClosing) propsDepth++
        continue
      }
      if (!isW) {
        // mc:Fallback repeats whatever mc:Choice already provided, which for a
        // text box means the same paragraph twice. Drop the fallback subtree.
        if (local === 'Fallback') { if (!token.selfClosing) skipDepth++; continue }
        continue // sdt, smartTag, AlternateContent: descend, ignore
      }
      if (local === 'p') {
        if (!token.selfClosing) frames.push({ kind: 'p', runs: [] })
        continue
      }
      if (local === 'tbl') {
        if (!token.selfClosing) frames.push({ kind: 'table', rows: [] })
        continue
      }
      if (local === 'tr') {
        if (!token.selfClosing) frames.push({ kind: 'row', cells: [] })
        continue
      }
      if (local === 'tc') {
        if (!token.selfClosing) frames.push({ kind: 'cell', blocks: [], spans: 1, vMerge: undefined })
        continue
      }
      if (local === 'delText' || local === 'instrText') {
        if (!token.selfClosing) skipDepth++
        continue
      }
      if (local === 'tab') {
        const frame = top()
        if (frame.kind === 'p' && propsDepth === 0) frame.runs.push('\t')
        continue
      }
      if (local === 'br' || local === 'cr') {
        const frame = top()
        if (frame.kind === 'p' && propsDepth === 0) frame.runs.push('\n')
        continue
      }
      if (local === 'gridSpan') {
        const frame = top()
        const value = Number.parseInt(token.attrs[`${W}val`] ?? token.attrs.val ?? '1', 10)
        if (frame.kind === 'cell' && Number.isFinite(value) && value > 1) frame.spans = value
        continue
      }
      if (local === 'vMerge') {
        const frame = top()
        const value = token.attrs[`${W}val`] ?? token.attrs.val ?? 'continue'
        if (frame.kind === 'cell') frame.vMerge = value === 'restart' ? 'restart' : 'continue'
        continue
      }
      // w:t is handled by the text token that follows it; w:delText is deleted
      // text and w:instrText is a field instruction, so neither belongs in the
      // output. Both are leaves, so no frame is needed.
      continue
    }

    // close
    if (!isW) {
      if (local === 'Fallback') { if (skipDepth > 0) skipDepth--; continue }
      continue
    }
    if (PROPS.has(local)) {
      if (propsDepth > 0) propsDepth--
      continue
    }
    if (local === 'delText' || local === 'instrText') {
      if (skipDepth > 0) skipDepth--
      continue
    }
    if (local === 'p') popP()
    else if (local === 'tc') popTc()
    else if (local === 'tr') popTr()
    else if (local === 'tbl') popTbl()
  }
  // Unterminated frames mean truncated XML; unwind them rather than lose text.
  while (frames.length > 1) {
    const kind = top().kind
    if (kind === 'p') popP()
    else if (kind === 'cell') popTc()
    else if (kind === 'row') popTr()
    else if (kind === 'table') popTbl()
    else frames.pop()
  }

  if (resolveVerticalMerge) {
    for (const block of body.blocks) {
      if (block.type !== 'table') continue
      for (let r = 0; r < block.rows.length; r++) {
        const cells = block.rows[r].cells
        for (let c = 0; c < cells.length; c++) {
          if (cells[c].vMerge !== 'continue' || cells[c].text !== '') continue
          for (let up = r - 1; up >= 0; up--) {
            const above = block.rows[up].cells[c]
            if (above !== undefined && above.text !== '') {
              cells[c].text = above.text
              break
            }
          }
        }
      }
    }
  }
  return body.blocks
}

const MERGED = '↔'
const LEGEND = `# 表格中 ${MERGED} 表示该格与左侧单元格合并，是占位符，不是数据。`

const render = (blocks, { legend = true } = {}) => {
  const lines = []
  let sawMerged = false
  for (const block of blocks) {
    if (block.type === 'p') {
      if (block.text.trim() !== '') lines.push(block.text)
      continue
    }
    for (const row of block.rows) {
      const cells = []
      for (const c of row.cells) {
        cells.push(c.text.replace(/\n+/gu, ' ').trim())
        // Keep the grid rectangular so a model counting columns does not drift
        // on a gridSpan row, but never pad with an empty string: an empty cell
        // reads as "value missing", and the model will try to fill it.
        for (let i = 1; i < c.spans; i++) {
          cells.push(MERGED)
          sawMerged = true
        }
      }
      if (cells.some(v => v !== '')) lines.push(`| ${cells.join(' | ')} |`)
    }
    lines.push('')
  }
  const body = lines.join('\n').trimEnd()
  return legend && sawMerged && body !== '' ? `${LEGEND}\n${body}` : body
}

/**
 * Extract readable text from a .docx buffer.
 * @param {Buffer} buffer - the file contents.
 * @param {{ resolveVerticalMerge?: boolean }} [options]
 * @returns {string} paragraphs one per line, table rows as `| a | b |`.
 */
export const docxToText = (buffer, options = {}) => {
  const zip = readZip(buffer)
  const xml = zip.read('word/document.xml')
  if (xml === undefined) throw new Error('no word/document.xml - is this a .docx, or a renamed .doc/.wps?')
  return render(extract(xml.toString('utf8'), options))
}

export { readZip, extract, render }
