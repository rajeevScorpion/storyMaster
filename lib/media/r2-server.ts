import 'server-only';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type PutObjectCommandInput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { getEffectiveMediaStorageConfig } from '@/lib/media/storage-config';
import { toR2Reference, parseR2Reference, parseR2UrlLikeReference } from '@/lib/media/r2-reference';

let cachedClient: S3Client | null = null;
let cachedClientKey: string | null = null;

async function getR2Client(): Promise<S3Client> {
  const config = await getEffectiveMediaStorageConfig();
  if (!config.r2.enabled || !config.r2.endpoint || !config.r2.accessKeyId || !config.r2.secretAccessKey) {
    throw new Error('R2 is not configured for this environment.');
  }

  const clientKey = `${config.r2.endpoint}:${config.r2.accessKeyId}`;
  if (cachedClient && cachedClientKey === clientKey) return cachedClient;

  cachedClient = new S3Client({
    region: 'auto',
    endpoint: config.r2.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.r2.accessKeyId,
      secretAccessKey: config.r2.secretAccessKey,
    },
  });
  cachedClientKey = clientKey;
  return cachedClient;
}

export async function getR2Bucket(access: 'public' | 'private'): Promise<string> {
  const config = await getEffectiveMediaStorageConfig();
  const bucket = access === 'public' ? config.r2.bucketName : config.r2.privateBucketName;
  if (!bucket) throw new Error(`Missing R2 ${access} bucket configuration.`);
  return bucket;
}

export async function getR2PublicUrl(objectKey: string): Promise<string> {
  const config = await getEffectiveMediaStorageConfig();
  if (!config.r2.publicDeliveryEnabled) throw new Error('R2 public delivery is disabled.');
  if (!config.r2.publicBaseUrl) throw new Error('Missing R2_PUBLIC_BASE_URL.');
  return `${config.r2.publicBaseUrl.replace(/\/$/, '')}/${objectKey.replace(/^\/+/, '')}`;
}

export async function createR2PresignedPutUrl(input: {
  access: 'public' | 'private';
  objectKey: string;
  contentType: string;
  cacheControl?: string;
  expiresIn?: number;
}): Promise<{ uploadUrl: string; bucket: string; objectKey: string; publicUrl?: string; reference?: string }> {
  const bucket = await getR2Bucket(input.access);
  const client = await getR2Client();
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: input.objectKey,
    ContentType: input.contentType,
    CacheControl: input.cacheControl,
  });
  const uploadUrl = await getSignedUrl(client, command, { expiresIn: input.expiresIn ?? 900 });
  return {
    uploadUrl,
    bucket,
    objectKey: input.objectKey,
    ...(input.access === 'public'
      ? { publicUrl: await getR2PublicUrl(input.objectKey) }
      : { reference: toR2Reference(bucket, input.objectKey) }),
  };
}

export async function putR2Object(input: {
  access: 'public' | 'private';
  objectKey: string;
  body: PutObjectCommandInput['Body'];
  contentType: string;
  cacheControl?: string;
}): Promise<{ bucket: string; objectKey: string; urlOrReference: string; publicUrl?: string }> {
  const bucket = await getR2Bucket(input.access);
  const client = await getR2Client();
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: input.objectKey,
    Body: input.body,
    ContentType: input.contentType,
    CacheControl: input.cacheControl,
  }));
  await r2ObjectExists({ bucket, objectKey: input.objectKey, throwOnError: true });
  const publicUrl = input.access === 'public' ? await getR2PublicUrl(input.objectKey) : undefined;
  return {
    bucket,
    objectKey: input.objectKey,
    urlOrReference: publicUrl ?? toR2Reference(bucket, input.objectKey),
    publicUrl,
  };
}

export async function r2ObjectExists(input: {
  bucket: string;
  objectKey: string;
  throwOnError?: boolean;
}): Promise<boolean> {
  const client = await getR2Client();
  try {
    await client.send(new HeadObjectCommand({ Bucket: input.bucket, Key: input.objectKey }));
    return true;
  } catch (error) {
    if (input.throwOnError) {
      throw error;
    }
    return false;
  }
}

export async function createR2SignedGetUrl(
  referenceOrBucket: string,
  objectKey?: string,
  expiresIn = 3600
): Promise<string | null> {
  const parsed = objectKey
    ? { bucket: referenceOrBucket, objectKey }
    : parseR2Reference(referenceOrBucket) ?? parseR2UrlLikeReference(referenceOrBucket);
  if (!parsed) return null;
  const client = await getR2Client();
  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: parsed.bucket, Key: parsed.objectKey }),
    { expiresIn }
  );
}

export async function getR2ObjectBuffer(reference: string): Promise<{ buffer: Buffer; contentType: string | null } | null> {
  const parsed = parseR2Reference(reference);
  if (!parsed) return null;
  const client = await getR2Client();
  const response = await client.send(new GetObjectCommand({ Bucket: parsed.bucket, Key: parsed.objectKey }));
  const bytes = await response.Body?.transformToByteArray();
  if (!bytes) return null;
  return {
    buffer: Buffer.from(bytes),
    contentType: response.ContentType ?? null,
  };
}

export async function deleteR2Object(referenceOrBucket: string, objectKey?: string): Promise<void> {
  const parsed = objectKey ? { bucket: referenceOrBucket, objectKey } : parseR2Reference(referenceOrBucket);
  if (!parsed) return;
  const client = await getR2Client();
  await client.send(new DeleteObjectCommand({ Bucket: parsed.bucket, Key: parsed.objectKey }));
}
