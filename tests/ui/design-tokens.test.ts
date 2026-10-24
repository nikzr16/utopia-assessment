import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 0011 plan P2: screens use only the named colours from `src/index.css`
 * (bg-surface, text-ink-muted, border-line, bg-brand, ...), so light and
 * dark mode switch in one place. A raw Tailwind palette class or a hex
 * colour in a component would not follow the theme.
 */
const RAW_PALETTE =
  /(?<![\w-])(?:[a-z-]+:)*(?:bg|text|border|ring|divide|outline|fill|stroke|from|to|via|decoration|placeholder|accent|caret|shadow)-(?:white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d{2,3})?(?:\/\d+)?(?![\w-])/g
const HEX = /#[0-9a-fA-F]{3,8}\b/g

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(tsx|ts)$/.test(name) ? [path] : []
  })
}

describe('Design tokens only (0011 P2)', () => {
  const files = sourceFiles('src')

  it('no component uses a raw Tailwind palette colour', () => {
    const found = files.flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(RAW_PALETTE)].map((m) => `${file}: ${m[0]}`),
    )
    expect(found).toEqual([])
  })

  it('no component hard-codes a hex colour', () => {
    const found = files.flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(HEX)]
        // `#main` style anchors are not colours.
        .filter((m) => /^#[0-9a-fA-F]+$/.test(m[0]) && !/href=["'`]#/.test(m.input!.slice(Math.max(0, m.index! - 7), m.index!)))
        .map((m) => `${file}: ${m[0]}`),
    )
    expect(found).toEqual([])
  })
})
