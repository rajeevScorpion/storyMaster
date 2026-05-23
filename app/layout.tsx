import type { Metadata, Viewport } from 'next';
import {
  Bebas_Neue,
  Inter,
  Lora,
  Montserrat,
  Oswald,
  Playfair_Display,
  Poppins,
} from 'next/font/google';
import Providers from '@/components/Providers';
import './globals.css'; // Global styles

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
});

const playfair = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-serif',
});

const bebas = Bebas_Neue({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-reel-bebas',
});

const oswald = Oswald({
  subsets: ['latin'],
  variable: '--font-reel-oswald',
});

const montserrat = Montserrat({
  subsets: ['latin'],
  variable: '--font-reel-montserrat',
});

const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-reel-poppins',
});

const lora = Lora({
  subsets: ['latin'],
  variable: '--font-reel-lora',
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  themeColor: '#0a0a0a',
};

export const metadata: Metadata = {
  title: 'Kissago',
  description: 'Interactive AI storytelling platform',
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en" className={`${inter.variable} ${playfair.variable} ${bebas.variable} ${oswald.variable} ${montserrat.variable} ${poppins.variable} ${lora.variable}`}>
      <body className="bg-neutral-950 text-neutral-200 font-sans antialiased" suppressHydrationWarning><Providers>{children}</Providers></body>
    </html>
  );
}
