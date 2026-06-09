import type { Metadata, Viewport } from 'next';
import {
  Bebas_Neue,
  Inter,
  Lora,
  Montserrat,
  Noto_Nastaliq_Urdu,
  Noto_Sans_Arabic,
  Noto_Sans_Bengali,
  Noto_Sans_Devanagari,
  Noto_Sans_Gujarati,
  Noto_Serif_Bengali,
  Noto_Serif_Devanagari,
  Noto_Serif_Gujarati,
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

const notoSansDevanagari = Noto_Sans_Devanagari({
  subsets: ['devanagari'],
  variable: '--font-reel-noto-sans-devanagari',
});

const notoSerifDevanagari = Noto_Serif_Devanagari({
  subsets: ['devanagari'],
  variable: '--font-reel-noto-serif-devanagari',
});

const notoSansBengali = Noto_Sans_Bengali({
  subsets: ['bengali'],
  variable: '--font-reel-noto-sans-bengali',
});

const notoSerifBengali = Noto_Serif_Bengali({
  subsets: ['bengali'],
  variable: '--font-reel-noto-serif-bengali',
});

const notoNastaliqUrdu = Noto_Nastaliq_Urdu({
  subsets: ['arabic'],
  variable: '--font-reel-noto-nastaliq-urdu',
});

const notoSansArabic = Noto_Sans_Arabic({
  subsets: ['arabic'],
  variable: '--font-reel-noto-sans-arabic',
});

const notoSansGujarati = Noto_Sans_Gujarati({
  subsets: ['gujarati'],
  variable: '--font-reel-noto-sans-gujarati',
});

const notoSerifGujarati = Noto_Serif_Gujarati({
  subsets: ['gujarati'],
  variable: '--font-reel-noto-serif-gujarati',
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
    <html lang="en" className={`${inter.variable} ${playfair.variable} ${bebas.variable} ${oswald.variable} ${montserrat.variable} ${poppins.variable} ${lora.variable} ${notoSansDevanagari.variable} ${notoSerifDevanagari.variable} ${notoSansBengali.variable} ${notoSerifBengali.variable} ${notoNastaliqUrdu.variable} ${notoSansArabic.variable} ${notoSansGujarati.variable} ${notoSerifGujarati.variable}`}>
      <body className="bg-neutral-950 text-neutral-200 font-sans antialiased" suppressHydrationWarning><Providers>{children}</Providers></body>
    </html>
  );
}
