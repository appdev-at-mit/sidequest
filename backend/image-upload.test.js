import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { sanitizeImage } from "./image-upload.js";

async function fixture(format, extension = format === "jpeg" ? "jpg" : format) {
  const buffer = await sharp({ create: { width: 32, height: 24, channels: 3, background: { r: 70, g: 130, b: 190 } } })
    .withMetadata({ exif: { IFD0: { Artist: "SideQuest test" } } })
    .toFormat(format)
    .toBuffer();
  const mime = format === "jpeg" ? "image/jpeg" : `image/${format}`;
  return { buffer, originalname: `fixture.${extension}`, mimetype: mime };
}

test("accepts JPEG, PNG and WebP and stores only sanitized WebP output", async () => {
  for (const format of ["jpeg", "png", "webp"]) {
    const output = await sanitizeImage(await fixture(format));
    assert.equal(output.format, "webp");
    assert.equal(output.mimeType, "image/webp");
    assert.equal(output.width, 32);
    assert.equal(output.height, 24);
    const metadata = await sharp(output.buffer).metadata();
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.exif, undefined);
    assert.equal(metadata.xmp, undefined);
    assert.equal(metadata.iptc, undefined);
  }
});

test("rejects mismatched extensions, content types, signatures and double extensions", async () => {
  const jpeg = await fixture("jpeg");
  await assert.rejects(sanitizeImage({ ...jpeg, originalname: "fixture.png" }), { statusCode: 415 });
  await assert.rejects(sanitizeImage({ ...jpeg, mimetype: "image/png" }), { statusCode: 415 });
  await assert.rejects(sanitizeImage({ ...jpeg, originalname: "payload.jpg.exe" }), { statusCode: 415 });
  await assert.rejects(sanitizeImage({ ...jpeg, buffer: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>") }), { statusCode: 415 });
  await assert.rejects(sanitizeImage({ ...jpeg, buffer: Buffer.from("not a jpeg") }), { statusCode: 415 });
});

test("rejects images exceeding configured dimensions and corrupt image data", async () => {
  const wide = await sharp({ create: { width: 4097, height: 1, channels: 3, background: "white" } }).png().toBuffer();
  await assert.rejects(sanitizeImage({ buffer: wide, originalname: "wide.png", mimetype: "image/png" }), { statusCode: 415 });
  const png = await fixture("png");
  await assert.rejects(sanitizeImage({ ...png, buffer: png.buffer.subarray(0, 32) }), { statusCode: 415 });
  const animatedPng = Buffer.concat([png.buffer.subarray(0, 33), Buffer.from([0, 0, 0, 8]), Buffer.from("acTL"), Buffer.from([0, 0, 0, 2, 0, 0, 0, 0]), png.buffer.subarray(33)]);
  await assert.rejects(sanitizeImage({ ...png, buffer: animatedPng }), /Animated or multi-image files are not supported/);
});
