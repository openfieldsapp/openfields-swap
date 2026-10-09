import type { AppProps } from 'next/app'
import dynamic from 'next/dynamic'
import Head from 'next/head'
import ErrorBoundary from 'components/ErrorBoundary'
import localFont from 'next/font/local'
import { TxRegionGateProvider } from 'components/RegionGate'
import 'styles/globals.css'
import 'styles/swap.css'
import 'styles/companion.css'

/**
 * The family typeface ships with the site (Montserrat, SIL Open Font License,
 * its variable Latin cut) rather than being loaded from Google's servers when a
 * page opens: loading it from Google sends every visitor's address to a third
 * party, and a German court held in 2022 that doing so without consent breaks
 * the GDPR. It is a local file, so the build does not reach Google either.
 */
const montserrat = localFont({ src: '../lib/fonts/montserrat-latin.woff2', weight: '100 900', display: 'swap' })

// The wallet stack (cosmos-kit, wallet adapters, WalletConnect) is client-only.
// Social meta is rendered here, server-side, so crawlers get it without it.
const Providers = dynamic(() => import('components/providers/Providers'), { ssr: false })

/** Per-page social card, resolved in the page's getServerSideProps. */
interface PageOg {
  title: string
  image?: string | null
  description?: string
  url?: string
  type?: 'website' | 'article'
}

export default function App({ Component, pageProps }: AppProps) {
  // A page that signs nothing and is framed by other sites (/embed) renders without the wallet stack.
  const bare = (Component as { bare?: boolean }).bare === true
  const og = (pageProps as { og?: PageOg } | undefined)?.og ?? null
  const title = og?.title ?? 'Openfields Swap'
  const description = og?.description ?? 'A decentralized exchange on Terra. Experimental.'
  return (
    <>
      <style jsx global>{`
        :root { --font: ${montserrat.style.fontFamily}, system-ui, -apple-system, 'Segoe UI', sans-serif; }
      `}</style>
      <Head>
        <title>{title}</title>
        <meta key='description' name='description' content={description} />
        <meta key='og:title' property='og:title' content={title} />
        <meta key='og:description' property='og:description' content={description} />
        <meta key='og:type' property='og:type' content={og?.type ?? 'website'} />
        {og?.url && <meta key='og:url' property='og:url' content={og.url} />}
        {og?.image && <meta key='og:image' property='og:image' content={og.image} />}
        <meta key='twitter:card' name='twitter:card' content='summary_large_image' />
        <meta key='twitter:title' name='twitter:title' content={title} />
        <meta key='twitter:description' name='twitter:description' content={description} />
        {og?.image && <meta key='twitter:image' name='twitter:image' content={og.image} />}
        <link key='icon' rel='icon' type='image/png' sizes='32x32' href='/img/openfields-x-32.png?v=20260923' />
        <link key='icon-lg' rel='icon' type='image/png' sizes='200x200' href='/img/openfields-x.png?v=20260923' />
        <link key='apple-touch-icon' rel='apple-touch-icon' href='/img/openfields-x-180.png?v=20260923' />
        <meta name='viewport' content='width=device-width, initial-scale=1, viewport-fit=cover' />
        {/* Installable as an app: home screen icon, full screen, the page colour behind the status bar. */}
        <link key='manifest' rel='manifest' href='/manifest.webmanifest' />
        <meta key='theme-color' name='theme-color' content='#07090f' />
        <meta key='apple-capable' name='apple-mobile-web-app-capable' content='yes' />
        <meta key='mobile-capable' name='mobile-web-app-capable' content='yes' />
        <meta key='apple-status' name='apple-mobile-web-app-status-bar-style' content='black-translucent' />
        <meta key='apple-title' name='apple-mobile-web-app-title' content='Swap' />
      </Head>
      {bare ? (
        <ErrorBoundary>
          <Component {...pageProps} />
        </ErrorBoundary>
      ) : (
        <ErrorBoundary>
          <Providers>
            <TxRegionGateProvider>
              <ErrorBoundary>
                <Component {...pageProps} />
              </ErrorBoundary>
            </TxRegionGateProvider>
          </Providers>
        </ErrorBoundary>
      )}
    </>
  )
}
