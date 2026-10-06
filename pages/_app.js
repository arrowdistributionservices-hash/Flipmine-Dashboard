import Head from 'next/head';
import '../styles/globals.css';

export default function App({ Component, pageProps }) {
  return (
    <>
      <Head>
        <title>Flipmine Dashboard | Arrow Distribution</title>
        <link rel="icon" type="image/png" href="/arrow-logo.png" />
      </Head>
      <Component {...pageProps} />
    </>
  );
}
