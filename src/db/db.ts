import Dexie, { type EntityTable } from 'dexie'

// ---- Domain types ---------------------------------------------------------

export type BookLanguage = 'ja' | 'en'

export interface Book {
  id: number
  title: string
  language: BookLanguage
  cover?: Blob // thumbnail
  createdAt: number
}

/** One detected text region on a page: tight box + recognized text + confidence. */
export interface OcrRegion {
  /** Axis-aligned box in source-image pixel coords. */
  box: { x: number; y: number; w: number; h: number }
  text: string
  /** Detection/recognition confidence in [0,1]; used to gate hallucinations. */
  confidence: number
}

/** Aligned source/translation sentence pair (stored per page). */
export interface SentencePair {
  source: string
  target: string
}

export interface Page {
  id: number
  bookId: number
  index: number
  imageBlob: Blob
  ocrRegions: OcrRegion[]
  fullText: string
  /** Joined translated text, when translated. */
  translation?: string
  /** Per-sentence pairs for side-by-side rendering, when translated. */
  translationPairs?: SentencePair[]
  processedAt?: number
}

export interface Bookmark {
  id: number
  bookId: number
  pageIndex: number
  label: string
  note?: string
  createdAt: number
}

export interface Note {
  id: number
  sourceType: 'word' | 'sentence'
  term: string
  reading?: string
  definition?: string
  contextSentence?: string
  bookId?: number
  pageIndex?: number
  userNote?: string
  tags: string[]
  createdAt: number
}

export interface Settings {
  /** Single-row table; fixed key. */
  id: 'app'
  targetLanguage: 'zh-Hant'
  preferredEngine: 'webgpu' | 'wasm' | 'auto'
  downloadedModels: string[]
}

// ---- Database -------------------------------------------------------------

const db = new Dexie('ReadingAppDB') as Dexie & {
  books: EntityTable<Book, 'id'>
  pages: EntityTable<Page, 'id'>
  bookmarks: EntityTable<Bookmark, 'id'>
  notes: EntityTable<Note, 'id'>
  settings: EntityTable<Settings, 'id'>
}

db.version(1).stores({
  // Only index fields used for lookups/sorting; blobs & JSON stay unindexed.
  books: '++id, title, language, createdAt',
  pages: '++id, bookId, [bookId+index], processedAt',
  bookmarks: '++id, bookId, [bookId+pageIndex], createdAt',
  notes: '++id, sourceType, term, bookId, createdAt',
  settings: 'id',
})

export const DEFAULT_SETTINGS: Settings = {
  id: 'app',
  targetLanguage: 'zh-Hant',
  preferredEngine: 'auto',
  downloadedModels: [],
}

export async function getSettings(): Promise<Settings> {
  const existing = await db.settings.get('app')
  if (existing) return existing
  await db.settings.put(DEFAULT_SETTINGS)
  return DEFAULT_SETTINGS
}

// ---- Books & pages --------------------------------------------------------

export async function createBook(
  title: string,
  language: BookLanguage,
  cover?: Blob,
): Promise<number> {
  return db.books.add({ title, language, cover, createdAt: Date.now() } as Book)
}

export async function listBooks(): Promise<Book[]> {
  return db.books.orderBy('createdAt').reverse().toArray()
}

export async function getBook(id: number): Promise<Book | undefined> {
  return db.books.get(id)
}

export async function countPages(bookId: number): Promise<number> {
  return db.pages.where('bookId').equals(bookId).count()
}

export async function listPages(bookId: number): Promise<Page[]> {
  return db.pages.where({ bookId }).sortBy('index')
}

export async function getPageAt(bookId: number, index: number): Promise<Page | undefined> {
  return db.pages.where('[bookId+index]').equals([bookId, index]).first()
}

export type NewPage = Omit<Page, 'id' | 'index' | 'processedAt'>

/** Append a page to a book; index is assigned as the current page count. */
export async function addPage(page: NewPage): Promise<number> {
  const index = await countPages(page.bookId)
  return db.pages.add({ ...page, index, processedAt: Date.now() } as Page)
}

export async function updatePage(id: number, patch: Partial<Page>): Promise<void> {
  await db.pages.update(id, patch)
}

export async function deleteBook(id: number): Promise<void> {
  await db.transaction('rw', db.books, db.pages, db.bookmarks, async () => {
    await db.pages.where('bookId').equals(id).delete()
    await db.bookmarks.where('bookId').equals(id).delete()
    await db.books.delete(id)
  })
}

export async function deletePage(id: number): Promise<void> {
  await db.pages.delete(id)
}

// ---- Notebook (notes) -----------------------------------------------------

export type NewNote = Omit<Note, 'id' | 'createdAt'>

export async function addNote(note: NewNote): Promise<number> {
  return db.notes.add({ ...note, createdAt: Date.now() } as Note)
}

export async function listNotes(): Promise<Note[]> {
  return db.notes.orderBy('createdAt').reverse().toArray()
}

export async function deleteNote(id: number): Promise<void> {
  await db.notes.delete(id)
}

export async function updateNote(id: number, patch: Partial<Note>): Promise<void> {
  await db.notes.update(id, patch)
}

// ---- Bookmarks ------------------------------------------------------------

export type NewBookmark = Omit<Bookmark, 'id' | 'createdAt'>

export async function addBookmark(bm: NewBookmark): Promise<number> {
  return db.bookmarks.add({ ...bm, createdAt: Date.now() } as Bookmark)
}

export async function listBookmarks(): Promise<Bookmark[]> {
  return db.bookmarks.orderBy('createdAt').reverse().toArray()
}

export async function deleteBookmark(id: number): Promise<void> {
  await db.bookmarks.delete(id)
}

export async function getBookmarkAt(
  bookId: number,
  pageIndex: number,
): Promise<Bookmark | undefined> {
  return db.bookmarks.where('[bookId+pageIndex]').equals([bookId, pageIndex]).first()
}

export { db }
