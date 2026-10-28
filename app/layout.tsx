import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Alerta Tram Tenerife — live tram / tranvía en directo',
  description: 'Independent Tenerife tram companion: live positions, visitor guidance and community alerts · Tranvías en directo, guía y avisos comunitarios.',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/favicon.png', apple: '/favicon.png' },
  applicationName: 'Alerta Tram',
  appleWebApp: { capable: true, title: 'Alerta Tram', statusBarStyle: 'default' },
  openGraph: {
    title: 'Alerta Tram',
    description: 'Live Tenerife trams, visitor guidance and community alerts.',
    type: 'website',
    locale: 'es_ES',
    alternateLocale: ['en_GB'],
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Alerta Tram Tenerife — live trams and community alerts' }],
  },
  twitter: { card: 'summary_large_image', images: ['/og.png'] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body></html>;
}
