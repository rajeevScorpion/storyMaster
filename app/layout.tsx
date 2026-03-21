import type {Metadata} from 'next';
import { Inter, Playfair_Display } from 'next/font/google';
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

export const metadata: Metadata = {
  title: 'Kissago',
  description: 'Interactive AI storytelling platform',
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en" className={`${inter.variable} ${playfair.variable}`}>
      <body className="bg-neutral-950 text-neutral-200 font-sans antialiased" suppressHydrationWarning><Providers>{children}</Providers></body>
    </html>
  );
}
