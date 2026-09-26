import { ImageResponse } from 'next/og';
import { renderKissagoMark } from '@/lib/brand/kissago-mark';

export const size = { width: 64, height: 64 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(renderKissagoMark(size.width), { ...size });
}
