import { DIE_IMAGE_SIZE, DIE_LIMITS } from './shared/dice';

/**
 * Turns a picture picked for a die face into a small square data URL: drawn whole and centered ("contain") at 3× the size
 * dice are shown on the board. PNG keeps transparency; a picture too heavy as PNG becomes a JPEG on white.
 */
export async function dieFaceImage(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Pick an image file');
  const image = await loadImage(file);
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = DIE_IMAGE_SIZE;
  const context = canvas.getContext('2d')!;
  const draw = () => {
    const scale = Math.min(DIE_IMAGE_SIZE / image.naturalWidth, DIE_IMAGE_SIZE / image.naturalHeight), w = image.naturalWidth * scale, h = image.naturalHeight * scale;
    context.imageSmoothingQuality = 'high'; context.drawImage(image, (DIE_IMAGE_SIZE - w) / 2, (DIE_IMAGE_SIZE - h) / 2, w, h);
  };
  draw();
  const png = canvas.toDataURL('image/png'); if (png.length <= DIE_LIMITS.imageChars) return png;
  context.fillStyle = 'white'; context.fillRect(0, 0, DIE_IMAGE_SIZE, DIE_IMAGE_SIZE); draw();
  for (const quality of [0.85, 0.7, 0.5]) { const jpeg = canvas.toDataURL('image/jpeg', quality); if (jpeg.length <= DIE_LIMITS.imageChars) return jpeg; }
  throw new Error('That picture could not be made small enough');
}

function loadImage(file: File) {
  const source = URL.createObjectURL(file);
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(source); image.naturalWidth && image.naturalHeight ? resolve(image) : reject(new Error('That image is empty')); };
    image.onerror = () => { URL.revokeObjectURL(source); reject(new Error('Could not read that image')); };
    image.src = source;
  });
}
