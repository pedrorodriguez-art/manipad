import type { CardSet } from './shared/types';
import { CARD_SET_LIMITS } from './shared/schemas';
import { CUSTOM_CARD_HEIGHT } from './shared/cards';

/**
 * Builds a card set from image files picked by the user: one card per image, the first file (in name order) on top.
 *
 * Every image is drawn, whole and centered ("contain"), on a white card shaped like the first image, at 3× the size cards
 * are shown on the board, and sent as a JPEG data URL. Downscaling here keeps the `importDeck` message within the socket's
 * 8 MB limit and the room's image budget.
 */
export const IMAGE_DECK_LIMITS = { files: 60, totalChars: 7_000_000 } as const;
const RESOLUTION = 3;

export type ImageDeckImport = { set: Omit<CardSet, 'id'>; warnings: string[] };

/** "card 2.png" comes before "card 10.png". */
export function orderImageFiles<T extends { name: string }>(files: T[]): T[] {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return [...files].sort((a, b) => collator.compare(a.name, b.name));
}

export const imageCardName = (fileName: string) => fileName.replace(/\.[^.]+$/, '').trim().slice(0, CARD_SET_LIMITS.text) || 'Image';

export function imageDeckName(files: { name: string }[]) {
  const name = files.length === 1 ? imageCardName(files[0].name) : `Images (${files.length})`;
  return name.slice(0, CARD_SET_LIMITS.name);
}

export async function buildImageDeck(picked: File[]): Promise<ImageDeckImport> {
  const images = orderImageFiles(picked.filter((file) => file.type.startsWith('image/')));
  if (!images.length) throw new Error('Pick one or more image files');
  if (images.length > IMAGE_DECK_LIMITS.files) throw new Error(`A deck can have at most ${IMAGE_DECK_LIMITS.files} images (you picked ${images.length})`);
  const warnings: string[] = [];
  const skippedOther = picked.length - images.length;
  const loaded: { file: File; image: HTMLImageElement }[] = []; let unreadable = 0;
  for (const file of images) { try { loaded.push({ file, image: await loadImage(file) }); } catch { unreadable++; } }
  if (!loaded.length) throw new Error('Could not read those images');
  if (unreadable + skippedOther) warnings.push(`${unreadable + skippedOther} file${unreadable + skippedOther === 1 ? ' was' : 's were'} skipped (not a readable image)`);

  const first = loaded[0].image, ratio = Math.min(2, Math.max(0.4, first.naturalWidth / first.naturalHeight));
  const height = CUSTOM_CARD_HEIGHT * RESOLUTION, width = Math.round(height * ratio);
  const faces = loaded.map(({ file, image }) => ({ fields: [{ name: 'File', kind: 'text' as const, text: imageCardName(file.name) }], image: render(image, width, height) }));
  if (faces.reduce((sum, face) => sum + face.image.length, 0) > IMAGE_DECK_LIMITS.totalChars) throw new Error('Those images are too large together; try fewer at a time');
  return { set: { name: imageDeckName(loaded.map((l) => l.file)), widthMm: Math.round(88 * ratio * 10) / 10, heightMm: 88, faces }, warnings };
}

function loadImage(file: File) {
  const source = URL.createObjectURL(file);
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(source); image.naturalWidth && image.naturalHeight ? resolve(image) : reject(new Error('empty')); };
    image.onerror = () => { URL.revokeObjectURL(source); reject(new Error('unreadable')); };
    image.src = source;
  });
}

function render(image: HTMLImageElement, width: number, height: number) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d')!; context.fillStyle = 'white'; context.fillRect(0, 0, width, height);
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight), w = image.naturalWidth * scale, h = image.naturalHeight * scale;
  context.imageSmoothingQuality = 'high'; context.drawImage(image, (width - w) / 2, (height - h) / 2, w, h);
  for (const quality of [0.85, 0.7, 0.5]) { const url = canvas.toDataURL('image/jpeg', quality); if (url.length <= CARD_SET_LIMITS.imageChars) return url; }
  throw new Error('An image could not be made small enough');
}
