// Smoke test: the protocol surface, the four tools, and the two claims that a
// registry listing makes on this server's behalf.
//
// Deliberately not a unit test of the check engine - that engine is tested in the
// workspace it comes from (53 packages, one suite each). What is unverified
// there, and verified only here, is the npm package as assembled: the version the
// server reports, whether the bundled engine loads from a directory with no
// node_modules, and whether the "read-only, no network" claim in the listing is
// still true of the code that actually ships.
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { handleRequest } from '../src/server.js'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const server = JSON.parse(await readFile(path.join(root, 'server.json'), 'utf8'))

const call = (method, params) => handleRequest({ jsonrpc: '2.0', id: 1, method, params })
const textOf = (res) => res.result.content.map((part) => part.text).join('\n')

// ---- manifests agree ----
assert.equal(server.name, pkg.mcpName, 'server.json name must equal package.json mcpName')
assert.equal(server.version, pkg.version, 'server.json version must equal package.json version')
assert.equal(server.packages[0].version, pkg.version, 'packages[].version must equal package.json version')
assert.equal(server.packages[0].identifier, pkg.name, 'packages[].identifier must equal the npm package name')
assert.ok(server.description.length <= 100, 'the registry caps description at 100 characters')

// ---- initialize reports the package version ----
const init = await call('initialize', {})
assert.equal(init.result.protocolVersion, '2024-11-05')
assert.equal(init.result.serverInfo.version, pkg.version)
assert.equal(await call('notifications/initialized', {}), null, 'notifications must not be answered')

// ---- the four tools are listed with schemas ----
const list = await call('tools/list', {})
const names = list.result.tools.map((tool) => tool.name).sort()
assert.deepEqual(names, ['customs_check', 'customs_read_docx', 'customs_rulebook', 'customs_schema'])
for (const tool of list.result.tools) {
  assert.ok(tool.description.length > 200, `${tool.name} needs a description a model can act on`)
  assert.equal(tool.annotations.readOnlyHint, true, `${tool.name} must declare itself read-only`)
  assert.equal(tool.annotations.destructiveHint, false)
  assert.ok(tool.inputSchema.type === 'object')
}

// ---- schema is the engine's own contract ----
const schema = JSON.parse(textOf(await call('tools/call', { name: 'customs_schema', arguments: {} })))
const hsCode = schema.columns.find((column) => column.field === 'hsCode')
assert.ok(hsCode.aliases.includes('商品编号'), 'the Chinese alias must survive the bundling')

// ---- the rulebook states its own coverage instead of implying it ----
const rulebook = JSON.parse(textOf(await call('tools/call', { name: 'customs_rulebook', arguments: {} })))
assert.equal(rulebook.coverage.rules, rulebook.rules.length)
assert.equal(rulebook.coverage.verbatimClause + rulebook.coverage.uncited, rulebook.coverage.rules)
assert.ok(
  rulebook.coverage.note.includes('does not mean the check has no basis'),
  'the coverage note must say what a missing clause does not mean',
)

// ---- a bad ledger produces findings, and each one is locatable ----
const ledger = await readFile(path.join(root, 'test/fixtures/ledger-bad.json'), 'utf8')
const report = textOf(await call('tools/call', { name: 'customs_check', arguments: { material: ledger } }))
for (const ruleId of ['CD-002', 'CD-003', 'CD-004', 'CD-005', 'CD-006', 'CD-007']) {
  assert.ok(report.includes(ruleId), `expected ${ruleId} to fire on the bad ledger`)
}
assert.ok(report.includes('未执行的检查'), 'the report must always carry the not-executed section')
assert.ok(report.includes('免责声明'), 'the report must carry its disclaimer')
assert.ok(!/合规|违规|违法/u.test(report.replace(/《[^》]*》|「[^」]*」/gu, '')), 'the report must not adjudicate')

// ---- onlyRules narrows the pack ----
const narrowed = textOf(
  await call('tools/call', { name: 'customs_check', arguments: { material: ledger, onlyRules: ['CD-002'] } }),
)
// The report is in two halves on purpose: the findings, then a list of rules that
// did not run. Checking the whole text would pass merely because the second half
// names the excluded rules - which is how the engine's onlyRules bug stayed
// invisible. Assert on the findings half only.
const findingsHalf = narrowed.split('## 未执行的检查')[0]
assert.ok(findingsHalf.includes('CD-002'), 'the selected rule must still run')
for (const excluded of ['CD-003', 'CD-004', 'CD-005', 'CD-006', 'CD-007']) {
  assert.ok(!findingsHalf.includes(excluded), `onlyRules must keep ${excluded} out of the findings`)
}

// ---- docx extraction reaches the bundled reader ----
const docxText = textOf(
  await call('tools/call', {
    name: 'customs_read_docx',
    arguments: { path: path.join(root, 'test/fixtures/sample.docx') },
  }),
)
assert.ok(docxText.includes('第三章 评标办法'), 'the docx body must come through')
assert.ok(docxText.includes('↔'), 'merged cells must be marked, not blanked')

// ---- documented refusals ----
const refusal = await call('tools/call', { name: 'customs_read_docx', arguments: { path: '/tmp/x.pdf' } })
assert.equal(refusal.result.isError, true, 'PDF must be refused, not attempted')
const unknown = await call('tools/call', { name: 'nope', arguments: {} })
assert.equal(unknown.error.code, -32602)
const badMethod = await handleRequest({ jsonrpc: '2.0', id: 1, method: 'resources/list' })
assert.equal(badMethod.error.code, -32601)

// ---- the "no network" claim, checked against the shipped source ----
const srcFiles = (await readdir(path.join(root, 'src'))).filter((name) => name.endsWith('.js') || name.endsWith('.mjs'))
for (const file of srcFiles) {
  const source = await readFile(path.join(root, 'src', file), 'utf8')
  for (const banned of ['node:http', 'node:https', 'node:net', 'node:dgram', 'fetch(']) {
    assert.ok(!source.includes(banned), `src/${file} must not use ${banned} - the listing says "no network"`)
  }
  for (const banned of ['writeFile', 'appendFile', 'createWriteStream', 'rm(', 'unlink']) {
    assert.ok(!source.includes(banned), `src/${file} must not use ${banned} - the listing says "no writes"`)
  }
}

// ---- the package installs nothing at runtime ----
assert.equal(pkg.dependencies, undefined, 'a bundled server must declare no dependencies')

console.log(`smoke: ${names.length} tools, ${rulebook.coverage.rules} rules (${rulebook.coverage.verbatimClause} with a verbatim clause), manifests at ${pkg.version}`)
