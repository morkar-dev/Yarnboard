/**
 * Shrinks a photo in the browser before it's uploaded: phone photos are
 * often 3-6MB each, the server caps a whole request at 5MB (see
 * MAX_CONTENT_LENGTH in backend/app/config.py), and the backend downscales
 * to 1600px anyway (photo.process_upload). Re-encoding through a canvas
 * also turns an iPhone HEIC -- which the browser can display but Pillow
 * can't read -- into a plain JPEG, and drops EXIF location data before it
 * ever leaves the device.
 *
 * Best-effort: if the browser can't decode the file, the original is
 * returned unchanged and the server reports it as unreadable.
 */
export async function resizeImage(file: File, maxDimension = 1600, quality = 0.85): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob) return file;
    return new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "photo"}.jpg`, { type: "image/jpeg" });
  } catch {
    return file;
  }
}
