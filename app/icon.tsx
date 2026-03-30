import { ImageResponse } from 'next/og';

export const size = { width: 64, height: 64 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#000000',
          borderRadius: '50%',
        }}
      >
        <span
          style={{
            fontSize: 44,
            fontWeight: 900,
            color: '#34d399',
            lineHeight: 1,
          }}
        >
          k
        </span>
      </div>
    ),
    { ...size }
  );
}
