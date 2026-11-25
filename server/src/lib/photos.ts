import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyRequest } from 'fastify';
import sharp from 'sharp';
import { AppError, badRequest } from './errors.js';

/**
 * Fotos subidas (ARQUITECTURA §1.3 y §5):
 * - el tipo real se detecta por el CONTENIDO (sharp), no por la extensión ni el Content-Type;
 * - cada foto se RE-CODIFICA a JPG de máx. 2000 px: eso elimina EXIF (incluida la ubicación GPS)
 *   y neutraliza archivos manipulados;
 * - se guardan fuera de la carpeta pública con un nombre aleatorio y solo se entregan por una ruta con permisos.
 */

export const MAX_PHOTOS = 5;
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const MAX_SIDE_PX = 2000;
/** Protege contra "bombas de descompresión" (imágenes diminutas en bytes, gigantes en píxeles). */
const MAX_INPUT_PIXELS = 60_000_000;
const ACCEPTED = new Set(['jpeg', 'png', 'webp', 'heif']); // heif aquí = AVIF (sharp no trae decodificador HEIC)

const HEIC_MESSAGE =
  'Las fotos en formato HEIC (iPhone) no se pueden leer. En el iPhone: Ajustes → Cámara → Formatos → «Más compatible», o envíala como JPG.';

export interface ProcessedPhoto {
  buffer: Buffer;
  width: number;
  height: number;
}

const looksLikeHeic = (b: Buffer) => /ftyp(heic|heix|hevc|hevx|mif1|msf1)/.test(b.subarray(0, 32).toString('latin1'));

export async function processPhoto(input: Buffer): Promise<ProcessedPhoto> {
  let format: string | undefined;
  let compression: string | undefined;
  try {
    const meta = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
    format = meta.format;
    compression = meta.compression;
  } catch {
    if (looksLikeHeic(input)) throw badRequest(HEIC_MESSAGE, 'HEIC_UNSUPPORTED');
    throw badRequest('Uno de los archivos no es una imagen válida.', 'INVALID_IMAGE');
  }
  if (format === 'heif' && compression === 'hevc') throw badRequest(HEIC_MESSAGE, 'HEIC_UNSUPPORTED');
  if (!format || !ACCEPTED.has(format)) {
    throw badRequest('Formato no permitido. Sube fotos JPG, PNG o WebP.', 'INVALID_IMAGE');
  }
  try {
    const { data, info } = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate() // aplica la orientación EXIF antes de descartarla
      .resize({ width: MAX_SIDE_PX, height: MAX_SIDE_PX, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' }) // PNG/WebP con transparencia → fondo blanco
      .jpeg({ quality: 82, mozjpeg: true }) // sin withMetadata(): sharp NO copia EXIF/XMP/ICC
      .toBuffer({ resolveWithObject: true });
    return { buffer: data, width: info.width, height: info.height };
  } catch {
    if (looksLikeHeic(input)) throw badRequest(HEIC_MESSAGE, 'HEIC_UNSUPPORTED');
    throw badRequest('No se pudo procesar una de las fotos. Prueba con otra.', 'INVALID_IMAGE');
  }
}

const KEY_RE = /^[0-9a-f]{32}\.jpg$/;

/** Almacén en disco. Las claves son aleatorias y se validan antes de tocar el sistema de archivos. */
export class PhotoStore {
  constructor(private readonly dir: string) {
    fs.mkdirSync(dir, { recursive: true });
  }

  save(buffer: Buffer): string {
    const key = `${randomBytes(16).toString('hex')}.jpg`;
    fs.writeFileSync(this.resolve(key), buffer, { flag: 'wx' });
    return key;
  }

  read(key: string): Buffer {
    return fs.readFileSync(this.resolve(key));
  }

  remove(key: string): void {
    fs.rmSync(this.resolve(key), { force: true });
  }

  private resolve(key: string): string {
    if (!KEY_RE.test(key)) throw new Error(`Clave de archivo inválida: ${key}`);
    return path.join(this.dir, key);
  }
}

export interface MultipartData {
  fields: Record<string, string>;
  files: Buffer[];
}

/** Lee un multipart/form-data completo (campos de texto + archivos), con mensajes claros al pasar los límites. */
export async function readMultipart(req: FastifyRequest): Promise<MultipartData> {
  if (!req.isMultipart()) throw badRequest('Se esperaba un formulario con archivos.');
  const fields: Record<string, string> = {};
  const files: Buffer[] = [];
  try {
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        const buf = await part.toBuffer();
        if (buf.length > 0) files.push(buf);
      } else if (typeof part.value === 'string') {
        fields[part.fieldname] = part.value;
      }
    }
  } catch (err) {
    const code = (err as { code?: string }).code ?? '';
    if (code === 'FST_REQ_FILE_TOO_LARGE') {
      throw new AppError(413, 'FILE_TOO_LARGE', `Cada foto puede pesar máximo ${MAX_PHOTO_BYTES / 1024 / 1024} MB.`);
    }
    if (code === 'FST_FILES_LIMIT' || code === 'FST_PARTS_LIMIT') {
      throw new AppError(413, 'TOO_MANY_FILES', `Máximo ${MAX_PHOTOS} fotos.`);
    }
    if (code === 'FST_FIELDS_LIMIT' || code === 'FST_PROTO_VIOLATION') throw badRequest('Formulario inválido.');
    throw err;
  }
  return { fields, files };
}
