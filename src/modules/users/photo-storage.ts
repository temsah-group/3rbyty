import { createHash, randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Public path photos are served under; stored on the user as-is. */
export const UPLOADS_ROUTE = '/uploads';
const AVATARS = 'avatars' as const;

export const MAX_PHOTO_MB = 5;
export const MAX_PART_PHOTO_MB = 8;

/** Image types accepted, told apart by their first bytes, not the file name. */
export function photoExtension(bytes: Buffer): 'jpg' | 'png' | 'webp' | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpg';
  }
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'png';
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

/** Folders under UPLOADS_DIR (or on Cloudinary), one per kind of photo. */
export type PhotoFolder = 'avatars' | 'parts' | 'shops' | 'offers';

/** Where uploaded photos live; callers only ever see the public path or URL. */
export interface PhotoStorage {
  /** Saves [bytes] in [folder] under a fresh name and returns its public path or URL. */
  save(folder: PhotoFolder, bytes: Buffer, extension: string): Promise<string>;
  saveAvatar(bytes: Buffer, extension: string): Promise<string>;
  /** Removes a photo saved here; anything else (an outside URL) is left alone. */
  remove(publicPath: string | null | undefined): Promise<void>;
  /** True for a photo this storage saved, which must be the uploader's own. */
  isOwn(publicPath: string): boolean;
}

/** Photos on the server's disk, served under /uploads: development and a single server. */
export class DiskPhotoStorage implements PhotoStorage {
  constructor(private readonly root: string) {}

  async save(folder: PhotoFolder, bytes: Buffer, extension: string): Promise<string> {
    const directory = path.join(this.root, folder);
    await mkdir(directory, { recursive: true });
    const name = `${randomUUID()}.${extension}`;
    await writeFile(path.join(directory, name), bytes);
    return `${UPLOADS_ROUTE}/${folder}/${name}`;
  }

  saveAvatar(bytes: Buffer, extension: string): Promise<string> {
    return this.save(AVATARS, bytes, extension);
  }

  async remove(publicPath: string | null | undefined): Promise<void> {
    const match = publicPath?.match(
      /^\/uploads\/(avatars|parts|shops|offers)\/([\w-]+\.(?:jpg|png|webp))$/,
    );
    if (!match) return;
    try {
      await unlink(path.join(this.root, match[1]!, match[2]!));
    } catch {
      // Already gone: nothing to do.
    }
  }

  isOwn(publicPath: string): boolean {
    return publicPath.startsWith(`${UPLOADS_ROUTE}/`);
  }
}

/** The parts of a `cloudinary://<key>:<secret>@<cloud>` URL (Cloudinary console > API Keys). */
export type CloudinaryAccount = { cloudName: string; apiKey: string; apiSecret: string };

export function parseCloudinaryUrl(value: string): CloudinaryAccount | null {
  const match = value.trim().match(/^cloudinary:\/\/([^:]+):([^@]+)@([\w-]+)$/);
  if (!match) return null;
  return { apiKey: match[1]!, apiSecret: match[2]!, cloudName: match[3]! };
}

/** Everything 3arabity stores sits under this Cloudinary folder. */
const CLOUD_ROOT = '3arabity';
/** Big photos are shrunk on arrival; nobody needs more than this. */
const MAX_SIDE = 1600;
/** Served in the best format and quality each browser takes (WebP/AVIF). */
const DELIVERY = 'f_auto,q_auto';

/**
 * Photos on Cloudinary, for production: off the server, so they survive
 * redeploys and moves. Talks to the upload API directly; no SDK needed.
 */
export class CloudinaryPhotoStorage implements PhotoStorage {
  private readonly base: string;

  constructor(private readonly account: CloudinaryAccount) {
    this.base = `https://res.cloudinary.com/${account.cloudName}/image/upload/`;
  }

  async save(folder: PhotoFolder, bytes: Buffer, extension: string): Promise<string> {
    const params: Record<string, string> = {
      // The folder goes in the id itself, so the URL carries it on every account type.
      public_id: `${CLOUD_ROOT}/${folder}/${randomUUID()}`,
      timestamp: String(Math.floor(Date.now() / 1000)),
      transformation: `c_limit,w_${MAX_SIDE},h_${MAX_SIDE}`,
    };
    const form = this.signed(params);
    form.append('file', new Blob([new Uint8Array(bytes)], { type: `image/${extension === 'jpg' ? 'jpeg' : extension}` }));
    const result = (await this.call('upload', form)) as { secure_url?: string };
    if (!result.secure_url?.startsWith(this.base)) throw new Error('Cloudinary upload failed');
    // Store the delivery URL, so every page gets the light version.
    return this.base + DELIVERY + '/' + result.secure_url.slice(this.base.length);
  }

  saveAvatar(bytes: Buffer, extension: string): Promise<string> {
    return this.save(AVATARS, bytes, extension);
  }

  async remove(publicPath: string | null | undefined): Promise<void> {
    if (!publicPath || !this.isOwn(publicPath)) return;
    const publicId = publicPath
      .slice(this.base.length)
      .match(/(?:^|\/)v\d+\/(.+)\.\w+$/)?.[1];
    if (!publicId?.startsWith(`${CLOUD_ROOT}/`)) return;
    try {
      await this.call('destroy', this.signed({ public_id: publicId, timestamp: String(Math.floor(Date.now() / 1000)) }));
    } catch {
      // Left on Cloudinary; nothing on the site points at it any more.
    }
  }

  isOwn(publicPath: string): boolean {
    return publicPath.startsWith(this.base);
  }

  /** The params, signed as Cloudinary asks: sorted, joined, SHA-1 with the secret. */
  private signed(params: Record<string, string>): FormData {
    const toSign = Object.keys(params)
      .sort()
      .map((key) => `${key}=${params[key]}`)
      .join('&');
    const form = new FormData();
    for (const [key, value] of Object.entries(params)) form.append(key, value);
    form.append('api_key', this.account.apiKey);
    form.append('signature', createHash('sha1').update(toSign + this.account.apiSecret).digest('hex'));
    return form;
  }

  private async call(action: 'upload' | 'destroy', form: FormData): Promise<unknown> {
    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${this.account.cloudName}/image/${action}`,
      { method: 'POST', body: form, signal: AbortSignal.timeout(30_000) },
    );
    const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
    if (!response.ok) throw new Error(`Cloudinary ${action}: ${body.error?.message ?? response.status}`);
    return body;
  }
}

/** Cloudinary when CLOUDINARY_URL is set, otherwise the server's disk. */
export function createPhotoStorage(env: { UPLOADS_DIR: string; CLOUDINARY_URL: string }): PhotoStorage {
  if (env.CLOUDINARY_URL) {
    const account = parseCloudinaryUrl(env.CLOUDINARY_URL);
    if (!account) throw new Error('CLOUDINARY_URL must look like cloudinary://<key>:<secret>@<cloud>');
    return new CloudinaryPhotoStorage(account);
  }
  return new DiskPhotoStorage(env.UPLOADS_DIR);
}
