import multer from "multer";
import sharp from "sharp";
import path from "node:path";

const MiB = 1024 * 1024;
export const MAX_IMAGE_BYTES = boundedInteger(process.env.MAX_IMAGE_BYTES, 5 * MiB, 64 * 1024, 20 * MiB);
export const MAX_IMAGE_WIDTH = boundedInteger(process.env.MAX_IMAGE_WIDTH, 4096, 64, 8192);
export const MAX_IMAGE_HEIGHT = boundedInteger(process.env.MAX_IMAGE_HEIGHT, 4096, 64, 8192);
export const MAX_IMAGE_PIXELS = boundedInteger(process.env.MAX_IMAGE_PIXELS, 16_777_216, 4096, 67_108_864);
export const MAX_CONCURRENT_IMAGE_UPLOADS = boundedInteger(process.env.MAX_CONCURRENT_IMAGE_UPLOADS, 3, 1, 16);
export const MAX_MESSAGE_IMAGES = 3;

const extensions = new Map([[".jpg", "jpeg"], [".jpeg", "jpeg"], [".png", "png"], [".webp", "webp"]]);
const mimeTypes = new Map([["jpeg", "image/jpeg"], ["png", "image/png"], ["webp", "image/webp"]]);
const signatures = {
  jpeg: buffer => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
  png: buffer => buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  webp: buffer => buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP",
};

sharp.concurrency(2);
sharp.cache({ memory: 64, files: 0, items: 32 });

let activeUploads = 0;
const receiveSingleFile = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 0, parts: 1, fieldNameSize: 32, headerPairs: 32 },
  fileFilter(_req, file, callback) {
    const name = file.originalname;
    const extension = path.extname(name).toLowerCase();
    const format = extensions.get(extension);
    const stem = path.basename(name, path.extname(name));
    const safeName = name.length <= 120 && !/[\\/\u0000-\u001f]/.test(name)
      && !stem.includes(".") && /^[\p{L}\p{N}_ -]{1,100}$/u.test(stem);
    if (!safeName || !format || file.mimetype !== mimeTypes.get(format)) {
      const error = new Error("Use a .jpg, .jpeg, .png, or .webp image with a matching image type.");
      error.code = "INVALID_IMAGE_TYPE";
      callback(error);
      return;
    }
    callback(null, true);
  },
}).single("image");

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function hasMultipleFrames(buffer, format) {
  if (format === "png") {
    let offset = 8;
    while (offset + 12 <= buffer.length) {
      const length = buffer.readUInt32BE(offset);
      if (offset + length + 12 > buffer.length) return false;
      if (buffer.toString("ascii", offset + 4, offset + 8) === "acTL") return true;
      offset += length + 12;
    }
    return false;
  }
  if (format === "webp") {
    let offset = 12;
    while (offset + 8 <= buffer.length) {
      const type = buffer.toString("ascii", offset, offset + 4);
      const length = buffer.readUInt32LE(offset + 4);
      if (offset + length + 8 > buffer.length) return false;
      if (type === "ANIM" || type === "ANMF") return true;
      if (type === "VP8X" && length > 0 && (buffer[offset + 8] & 0x02) !== 0) return true;
      offset += 8 + length + (length % 2);
    }
    return false;
  }
  return format === "jpeg" && buffer.includes(Buffer.from("MPF\0", "ascii"));
}

function uploadError(res, error) {
  if (error?.code === "LIMIT_FILE_SIZE") return res.status(413).json({ msg: `Choose an image no larger than ${Math.floor(MAX_IMAGE_BYTES / MiB)} MB.` });
  if (error?.code === "LIMIT_UNEXPECTED_FILE" || error?.code === "LIMIT_FILE_COUNT" || error?.code === "LIMIT_PART_COUNT" || error?.code === "LIMIT_FIELD_COUNT") return res.status(400).json({ msg: "Upload one image in the image field." });
  if (error?.code === "INVALID_IMAGE_TYPE") return res.status(415).json({ msg: error.message });
  return res.status(400).json({ msg: "The image upload could not be read." });
}

export function receiveImage(req, res, next) {
  if (activeUploads >= MAX_CONCURRENT_IMAGE_UPLOADS) return res.status(503).json({ msg: "Image uploads are busy. Please try again shortly." });
  activeUploads += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    activeUploads = Math.max(0, activeUploads - 1);
  };
  res.once("finish", release);
  res.once("close", release);
  req.once("aborted", release);
  receiveSingleFile(req, res, error => {
    if (error) {
      release();
      uploadError(res, error);
      return;
    }
    next();
  });
}

export async function sanitizeImage(file) {
  if (!file?.buffer?.length || file.buffer.length > MAX_IMAGE_BYTES) throw imageError("The image is empty or too large.");
  const extensionFormat = extensions.get(path.extname(file.originalname).toLowerCase());
  const signatureFormat = Object.entries(signatures).find(([, matches]) => matches(file.buffer))?.[0];
  if (!extensionFormat || !signatureFormat || extensionFormat !== signatureFormat || file.mimetype !== mimeTypes.get(signatureFormat)) {
    throw imageError("The file name, image type, and image contents must all match JPEG, PNG, or WebP.");
  }
  if (hasMultipleFrames(file.buffer, signatureFormat)) throw imageError("Animated or multi-image files are not supported.");

  const inputOptions = { failOn: "warning", limitInputPixels: MAX_IMAGE_PIXELS, sequentialRead: true };
  try {
    const source = sharp(file.buffer, inputOptions).timeout({ seconds: 5 });
    const metadata = await source.metadata();
    if (metadata.format !== signatureFormat || (metadata.pages ?? 1) !== 1 || metadata.width == null || metadata.height == null
      || metadata.width > MAX_IMAGE_WIDTH || metadata.height > MAX_IMAGE_HEIGHT || metadata.width * metadata.height > MAX_IMAGE_PIXELS) {
      throw imageError("Use one static image no larger than 4096 × 4096 pixels.");
    }

    const { data, info } = await sharp(file.buffer, inputOptions)
      .timeout({ seconds: 5 })
      .rotate()
      .resize({ width: MAX_IMAGE_WIDTH, height: MAX_IMAGE_HEIGHT, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 84, effort: 4 })
      .toBuffer({ resolveWithObject: true });
    if (!data.length || data.length > MAX_IMAGE_BYTES || info.width > MAX_IMAGE_WIDTH || info.height > MAX_IMAGE_HEIGHT
      || info.width * info.height > MAX_IMAGE_PIXELS) throw imageError("The sanitized image exceeds the allowed size or dimensions.");
    return { buffer: data, width: info.width, height: info.height, size: data.length, format: "webp", mimeType: "image/webp" };
  } catch (error) {
    if (error?.statusCode) throw error;
    throw imageError("The image is malformed, unsupported, animated, or took too long to process.");
  }
}

function imageError(message) {
  const error = new Error(message);
  error.statusCode = 415;
  return error;
}

export const imageUploadLimits = Object.freeze({ MAX_IMAGE_BYTES, MAX_IMAGE_WIDTH, MAX_IMAGE_HEIGHT, MAX_IMAGE_PIXELS, MAX_CONCURRENT_IMAGE_UPLOADS });
