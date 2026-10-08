#!/usr/bin/env node
// Reports translation gaps: keys missing from (or unknown to) each locale compared with English,
// {{placeholders}} that differ from English, locales not registered in src/i18n/languages.ts (or
// registered without a file), and backend message codes (backend/app/errors.py) with no English text.
// Missing keys fall back to English at runtime, so this only fails with --strict.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const localesDir = join(root, 'src', 'locales')
const strict = process.argv.includes('--strict')
const SOURCE = 'en'
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/

function flatten(object, prefix = '', out = new Map()) {
  for (const [key, value] of Object.entries(object)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object') flatten(value, path, out)
    else out.set(path, String(value))
  }
  return out
}

// Plural forms differ per language (en: one/other, pl: one/few/many/other), so compare base keys.
function byBaseKey(entries) {
  const result = new Map()
  for (const [key, value] of entries) {
    const base = key.replace(PLURAL_SUFFIX, '')
    result.set(base, [...(result.get(base) ?? []), value])
  }
  return result
}

function placeholders(values) {
  const names = new Set()
  for (const value of values) {
    for (const match of value.matchAll(/\{\{\s*([\w.]+)/g)) names.add(match[1])
  }
  return [...names].sort().join(',')
}

function loadLocale(code) {
  return byBaseKey(flatten(JSON.parse(readFileSync(join(localesDir, code, 'translation.json'), 'utf8'))))
}

const problems = []
const source = loadLocale(SOURCE)

const onDisk = readdirSync(localesDir).filter((name) => existsSync(join(localesDir, name, 'translation.json')))
const languagesFile = readFileSync(join(root, 'src', 'i18n', 'languages.ts'), 'utf8')
const registered = [...languagesFile.matchAll(/code:\s*'([^']+)'/g)].map((match) => match[1])

for (const code of onDisk.filter((c) => !registered.includes(c))) {
  problems.push(`${code}: src/locales/${code}/translation.json exists but is not listed in src/i18n/languages.ts`)
}
for (const code of registered.filter((c) => !onDisk.includes(c))) {
  problems.push(`${code}: listed in src/i18n/languages.ts but src/locales/${code}/translation.json is missing`)
}

for (const code of onDisk.filter((c) => c !== SOURCE)) {
  const locale = loadLocale(code)
  const missing = [...source.keys()].filter((key) => !locale.has(key))
  const extra = [...locale.keys()].filter((key) => !source.has(key))
  const mismatched = [...locale.keys()].filter(
    (key) => source.has(key) && placeholders(source.get(key)) !== placeholders(locale.get(key)),
  )
  const total = source.size
  console.log(`${code}: ${total - missing.length}/${total} keys translated`)
  for (const key of missing) problems.push(`${code}: missing ${key}`)
  for (const key of extra) problems.push(`${code}: unknown key ${key} (not in ${SOURCE})`)
  for (const key of mismatched) {
    problems.push(`${code}: ${key} uses {{${placeholders(locale.get(key))}}}, ${SOURCE} uses {{${placeholders(source.get(key))}}}`)
  }
}

const errorsPy = join(root, '..', 'backend', 'app', 'errors.py')
if (existsSync(errorsPy)) {
  const registry = readFileSync(errorsPy, 'utf8').match(/^MESSAGES[^{]*\{([\s\S]*?)^\}/m)?.[1] ?? ''
  const codes = [...registry.matchAll(/^\s*"([a-z0-9_]+(?:\.[a-z0-9_]+)+)":/gm)].map((match) => match[1])
  for (const code of codes.filter((c) => !source.has(`server.${c}`))) {
    problems.push(`${SOURCE}: backend code ${code} has no text at server.${code}`)
  }
  for (const key of [...source.keys()].filter((k) => k.startsWith('server.') && !codes.includes(k.slice(7)))) {
    problems.push(`${SOURCE}: ${key} is not a backend code in backend/app/errors.py`)
  }
}

if (problems.length) {
  console.log(`\n${problems.length} issue(s):`)
  for (const problem of problems) console.log(`  - ${problem}`)
  if (strict) process.exit(1)
} else {
  console.log('All translations are complete.')
}
