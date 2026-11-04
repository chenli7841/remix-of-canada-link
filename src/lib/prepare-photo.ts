// Shared by mobile camera and album inputs. Normalize large photos before upload.
export async function preparePhoto(file: File, maxBytes = 2 * 1024 * 1024): Promise<string> {
  if (!file.type.startsWith('image/') || file.size > 25 * 1024 * 1024) throw new Error('请选择25MB以内的照片');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url;
    try { await image.decode(); } catch { throw new Error('手机无法读取此图片，请选择JPEG/PNG照片，或使用相机的兼容格式'); }
    let size = 1800;
    for (let attempt = 0; attempt < 5; attempt++) {
      const scale = Math.min(1, size / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
      const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('无法读取照片');
      ctx.fillStyle = 'white'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const result = canvas.toDataURL('image/jpeg', 0.82);
      if ((result.length - result.indexOf(',') - 1) * 3 / 4 <= maxBytes) return result;
      size *= 0.75;
    }
    throw new Error('照片压缩后仍过大，请选择较小的照片');
  } finally { URL.revokeObjectURL(url); }
}
