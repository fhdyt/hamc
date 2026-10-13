import { writeFile } from 'node:fs/promises'
import { dialog, type BrowserWindow, type SaveDialogReturnValue } from 'electron'
import type { ExportExt, ExportResult } from '@shared/sessions'

export const EXPORT_MAX_BYTES = 50 * 1024 * 1024
const EXTS: readonly ExportExt[] = ['jsonl', 'md', 'html']

export type SaveDialog = (win: BrowserWindow | null, opts: { defaultPath: string; filters: { name: string; extensions: string[] }[] }) => Promise<SaveDialogReturnValue>

export const nativeSaveDialog: SaveDialog = (win, opts) => (win ? dialog.showSaveDialog(win, opts) : dialog.showSaveDialog(opts))

export const safeName = (n: string): string => n.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80) || 'session'

/** Writes an export the user asked for, to the path they pick in the native dialog. Nothing else is ever written. */
export async function saveExport(req: { name: string; ext: ExportExt; content: string }, win: BrowserWindow | null, pick: SaveDialog = nativeSaveDialog): Promise<ExportResult> {
  if (!EXTS.includes(req.ext)) return { failed: 'Unsupported format.' }
  if (Buffer.byteLength(req.content, 'utf8') > EXPORT_MAX_BYTES) return { failed: 'The export is larger than 50 MB.' }
  const res = await pick(win, { defaultPath: `${safeName(req.name)}.${req.ext}`, filters: [{ name: req.ext.toUpperCase(), extensions: [req.ext] }] })
  if (res.canceled || !res.filePath) return { canceled: true }
  try {
    await writeFile(res.filePath, req.content, 'utf8')
    return { saved: res.filePath }
  } catch (e) {
    return { failed: e instanceof Error ? e.message : String(e) }
  }
}
