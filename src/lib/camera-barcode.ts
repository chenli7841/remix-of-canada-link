import { scanImageData, setModuleArgs } from '@undecaf/zbar-wasm';
import wasmUrl from '@undecaf/zbar-wasm/dist/zbar.wasm?url';

// Serve the decoder from this site; camera frames never leave the device.
setModuleArgs({ locateFile: () => wasmUrl });

export async function decodeCameraFrame(frame: ImageData): Promise<string[]> {
  const symbols = await scanImageData(frame);
  return [...new Set(symbols.map(symbol => symbol.decode().trim()))]
    .filter(code => code.length > 0 && code.length <= 256 && !/[\u0000-\u001f\u007f]/.test(code));
}
