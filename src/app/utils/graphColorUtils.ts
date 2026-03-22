// Color utility helpers for graph animation and highlighting
// Ported from GitNexus useSigma.ts

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : { r: 100, g: 100, b: 100 };
}

function rgbToHex(r: number, g: number, b: number): string {
  return (
    '#' +
    [r, g, b]
      .map((x) => {
        const h = Math.max(0, Math.min(255, Math.round(x))).toString(16);
        return h.length === 1 ? '0' + h : h;
      })
      .join('')
  );
}

const DARK_BG = { r: 17, g: 19, b: 32 }; // #111320
const LIGHT_BG = { r: 243, g: 244, b: 246 }; // #f3f4f6

/**
 * Mix a color toward the background color.
 * amount=0 -> pure background, amount=1 -> original color.
 */
export function dimColor(
  hex: string,
  amount: number,
  theme: 'dark' | 'light' = 'dark',
): string {
  const rgb = hexToRgb(hex);
  const bg = theme === 'dark' ? DARK_BG : LIGHT_BG;
  return rgbToHex(
    bg.r + (rgb.r - bg.r) * amount,
    bg.g + (rgb.g - bg.g) * amount,
    bg.b + (rgb.b - bg.b) * amount,
  );
}

/**
 * Brighten a color by mixing toward white.
 * factor=1 -> no change, factor=2 -> halfway to white.
 */
export function brightenColor(hex: string, factor: number): string {
  const rgb = hexToRgb(hex);
  return rgbToHex(
    rgb.r + ((255 - rgb.r) * (factor - 1)) / factor,
    rgb.g + ((255 - rgb.g) * (factor - 1)) / factor,
    rgb.b + ((255 - rgb.b) * (factor - 1)) / factor,
  );
}
