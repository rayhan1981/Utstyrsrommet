// Client-side image compression for product/item photos.
// Reads a File, draws into a canvas scaled to maxDim, exports as JPEG data URL.
// Keeps result well under ~250KB for a typical product shot.
export async function compressImage(file, { maxDim = 900, quality = 0.82 } = {}) {
  if (!file) return null;
  if (!file.type?.startsWith("image/")) throw new Error("Filen må være et bilde");
  const dataUrl = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = dataUrl;
  });
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  // White backdrop so transparent PNGs don't go black when encoded as JPEG
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", quality);
}
